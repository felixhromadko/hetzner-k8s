import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";
import * as hcloud from "@pulumi/hcloud";

const infraStackRef = new pulumi.StackReference('organization/infrastructure/dev')
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



export const HttpIngressIp = lbIngress.ipv4
