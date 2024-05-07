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
  const monitoringNamespace = new kubernetes.core.v1.Namespace('kube-monitoring', {
    metadata: {
      name: "kube-monitoring",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged"
      }
    },
  }, {provider: k8sProvider})
  const promOperator = new kubernetes.helm.v3.Release("kube-prometheus-stack", {
    namespace: monitoringNamespace.metadata.name,
    name: "kube-prometheus-stack",
    chart: "kube-prometheus-stack",
    repositoryOpts: {
      repo: "https://prometheus-community.github.io/helm-charts",
    },
    values: {
      grafana: {
        persistence: {
          enabled: true,
          accessModes: ["ReadWriteOnce"],
          size: "5Gi"
        }
      },
      prometheus: {
        prometheusSpec: {
          podMonitorSelectorNilUsesHelmValues: false,
          storageSpec: {
            volumeClaimTemplate: {
              spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                  requests: {
                    storage: '5Gi'
                  }
                }
              },
              selector: {}
            }
          }
        }
      }
    }
  }, {provider: k8sProvider});
}