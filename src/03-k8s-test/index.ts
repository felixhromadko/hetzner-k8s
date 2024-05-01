import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";
import * as hcloud from "@pulumi/hcloud";

const infraStackRef = new pulumi.StackReference('organization/infrastructure/dev')
const kubeConfig = infraStackRef.getOutput("kubeConfigYml")

const k8sProvider = new kubernetes.Provider('talos', {
  kubeconfig: kubeConfig
})

// stuff to test
const testNs = new kubernetes.core.v1.Namespace('test', {}, {provider: k8sProvider})

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
}, {provider: k8sProvider})

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
}, {provider: k8sProvider})

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
}, {provider: k8sProvider})

const whoamiService = new kubernetes.core.v1.Service('whoami-test', {
  metadata: {namespace: testNs.id},
  spec: {
    type: "ClusterIP",
    selector: {app: whoamiRs.spec.selector.matchLabels.app},
    ports: [
      {name: 'http', port: 80}
    ]
  }
}, {provider: k8sProvider})

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
}, {provider: k8sProvider})
