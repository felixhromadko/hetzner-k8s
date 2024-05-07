import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";
import * as hcloud from "@pulumi/hcloud";
import * as certmanager from "@pulumi/kubernetes-cert-manager";
import * as random from '@pulumi/random'

const config = new pulumi.Config()

const postgresEnabled = config.getBoolean("postgres_enabled")
const monitoringEnabled = config.getBoolean("monitoring_enabled")

const infraStackRef = new pulumi.StackReference('organization/infrastructure/main')
const kubeConfig = infraStackRef.getOutput("kubeConfigYml")
const hcloudToken = infraStackRef.getOutput("hcloudToken")


const hcloudProvider = new hcloud.Provider('hcloud', {
  token: hcloudToken,
})

const k8sProvider = new kubernetes.Provider('talos', {
  kubeconfig: kubeConfig
})


// setup hcloud csi
new kubernetes.core.v1.Secret('hcloud', {
  metadata: {namespace: "kube-system", name: "hcloud"},
  stringData: {token: hcloudToken}
}, {provider: k8sProvider})
new kubernetes.helm.v3.Release('hcloud-csi', {
  chart: 'hcloud-csi',
  repositoryOpts: {
    repo: "https://charts.hetzner.cloud",
  },
  namespace: "kube-system"
}, {provider: k8sProvider})

// setup contour
new kubernetes.helm.v3.Release('contour', {
  chart: 'contour',
  repositoryOpts: {
    repo: "https://charts.bitnami.com/bitnami",
  },
  namespace: "projectcontour",
  createNamespace: true,
  values: {
    envoy: {
      service: {
        type: 'NodePort',
        nodePorts: {
          http: 30080,
          https: 30443,
        }
      }
    }
  }
}, {provider: k8sProvider})

const lbIngress = new hcloud.LoadBalancer('http-ingress', {
  loadBalancerType: 'lb11',
  location: 'fsn1'
}, {provider: hcloudProvider})
const lbIngressId = lbIngress.id.apply(a => parseInt(a))

new hcloud.LoadBalancerService('http-ingress-https', {
  loadBalancerId: lbIngress.id,
  listenPort: 443,
  destinationPort: 30443,
  protocol: 'tcp',
}, {provider: hcloudProvider})
new hcloud.LoadBalancerService('http-ingress-http', {
  loadBalancerId: lbIngress.id,
  listenPort: 80,
  destinationPort: 30080,
  protocol: 'tcp',
}, {provider: hcloudProvider})
new hcloud.LoadBalancerTarget('http-ingress-target', {
  loadBalancerId: lbIngressId,
  labelSelector: "type=worker",
  type: "label_selector",
  usePrivateIp: false,
}, {provider: hcloudProvider})

const certManager = new certmanager.CertManager("cert-manager", {
  installCRDs: true,
  helmOptions: {
    namespace: "kube-system",
  }
}, {provider: k8sProvider})

const letsEncryptClusterIssuer = new kubernetes.apiextensions.CustomResource("lets-encrypt-cluster-issuer", {
  apiVersion: "cert-manager.io/v1",
  kind: "ClusterIssuer",
  metadata: {
    name: "letsencrypt-prod"
  },
  spec: {
    acme: {
      server: "https://acme-v02.api.letsencrypt.org/directory",
      privateKeySecretRef: {
        name: "letsencrypt-prod"
      },
      solvers: [{
        http01: {
          ingress: {
            class: "contour"
          }
        }
      }]
    }
  }
}, {provider: k8sProvider, dependsOn: [certManager]})

export const HttpIngressIp = lbIngress.ipv4


if (postgresEnabled) {
  new kubernetes.helm.v3.Release('cnpg', {
    chart: "cloudnative-pg",
    createNamespace: true,
    namespace: "cnpg-system",
    repositoryOpts: {
      repo: "https://cloudnative-pg.github.io/charts"
    }
  }, {provider: k8sProvider})
}
if (monitoringEnabled) {
  const grafanaPassword = new random.RandomPassword('grafana-password', {length: 16})

  const monitoringNamespace = new kubernetes.core.v1.Namespace('kube-monitoring', {
    metadata: {
      name: "kube-monitoring",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged"
      }
    },
  }, {provider: k8sProvider})

  const lgtmChart = new kubernetes.helm.v3.Release("lgtm-stack", {
    name: 'lgtm-stack',
    chart: "lgtm-distributed",
    repositoryOpts: {
      repo: "https://grafana.github.io/helm-charts",
    },
    namespace: monitoringNamespace.metadata.name,
    values: {
      grafana: {
        adminPassword: grafanaPassword.result,
      }
    }
  }, {provider: k8sProvider});

  const k8sMonitoring = new kubernetes.helm.v3.Release('kube-monitoring', {
    chart: 'k8s-monitoring',
    repositoryOpts: {
      repo: "https://grafana.github.io/helm-charts",
    },
    namespace: monitoringNamespace.metadata.name,
    values: {
      cluster: {
        name: "k8s-cluster"
      },
      opencost: {
        enabled: false
      },
      externalServices: {
        cost: {
          enabled: false,
        },
        loki: {
          host: 'http://lgtm-stack-loki-gateway',
          username: "",
          password: "",
        },
        prometheus: {
          host: 'http://lgtm-stack-mimir-nginx',
          writeEndpoint: '/api/v1/push',
          queryEndpoint: '/prometheus/api/v1/query',
          username: "",
          password: "",
        }
      }
    }
  }, {provider: k8sProvider})
}