import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";
import {hcloudToken, kubeConfig} from "./index";
import * as hcloud from "@pulumi/hcloud";

const k8s = new kubernetes.Provider('talos', {
  kubeconfig: kubeConfig.kubeconfigRaw
})

// setup hcloud csi
new kubernetes.core.v1.Secret('hcloud', {
  metadata: {namespace: "kube-system", name: "hcloud"},
  stringData: {token: hcloudToken}
})
new kubernetes.helm.v3.Release('hcloud-csi', {
  chart: 'hcloud-csi',
  repositoryOpts: {
    repo: "https://charts.hetzner.cloud",
  },
  namespace: "kube-system"
})

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
})

const lbIngress = new hcloud.LoadBalancer('http-ingress', {
  loadBalancerType: 'lb11',
  location: 'fsn1'
})
const lbIngressId = lbIngress.id.apply(a => parseInt(a))

new hcloud.LoadBalancerService('http-ingress-https', {
  loadBalancerId: lbIngress.id,
  listenPort: 443,
  destinationPort: 30443,
  protocol: 'tcp',
})
new hcloud.LoadBalancerService('http-ingress-http', {
  loadBalancerId: lbIngress.id,
  listenPort: 80,
  destinationPort: 30080,
  protocol: 'tcp',
})
new hcloud.LoadBalancerTarget('http-ingress-target', {
  loadBalancerId: lbIngressId,
  labelSelector: "type=worker",
  type: "label_selector",
  usePrivateIp: false,
})



// stuff to test
const testNs = new kubernetes.core.v1.Namespace('test')

const statefulPvc = new kubernetes.core.v1.PersistentVolumeClaim('test', {
  metadata: {namespace: testNs.id, annotations: {"pulumi.com/skipAwait": "true"}},
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: {
      requests: {
        storage: "1Gi"
      }
    },
  }
})

new kubernetes.apps.v1.ReplicaSet('stateful-test', {
  metadata: {namespace: testNs.id},
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {app: 'stateful-test'}
    },
    template: {
      metadata: {
        labels: {app: 'stateful-test'},
      },
      spec: {
        containers: [{
          name: "stateful-test",
          image: "alpine:latest",
          command: ['tail', '-f', '/dev/null'],
          volumeMounts: [{
           name: 'data', mountPath: "/data",
          }],
        }],
        volumes: [{
          name: "data",
          persistentVolumeClaim: {claimName: statefulPvc.metadata.name}
        }]
      }
    }
  }
})

const whoamiRs = new kubernetes.apps.v1.ReplicaSet('whoami-test', {
  metadata: {namespace: testNs.id},
  spec: {
    replicas: 5,
    selector: {matchLabels: {app: "whoami-test"}},
    template: {
      metadata: {labels: {app: 'whoami-test'}},
      spec: {
        containers: [{
          name: 'whoami-test',
          image: 'traefik/whoami',
          ports: [{name: 'http', containerPort: 80}]
        }]
      }
    }
  }
})

const whoamiService = new kubernetes.core.v1.Service('whoami-test', {
  metadata: {namespace: testNs.id},
  spec: {
    type: "ClusterIP",
    selector: {app: whoamiRs.spec.selector.matchLabels.app},
    ports: [
      {name: 'http', port: 80}
    ]
  }
})

const whoamiIngress = new kubernetes.networking.v1.Ingress('whoami-test', {
  metadata: {namespace: testNs.id, annotations: {'pulumi.com/skipAwait': 'true'}},
  spec: {
    rules: [{
      http: {
        paths: [{
          pathType: 'Prefix',
          path: "/",
          backend: {
            service: {
              name: whoamiService.metadata.name,
              port: {number: 80}
            }
          }
        }]
      }
    }]
  }
}, {})
