import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import * as talos from "@pulumiverse/talos";
import {ConfigurationApply} from "@pulumiverse/talos/machine";
import * as YAML from 'yaml'

const HetznerImageId = '160372084'
const HetznerInstanceName = 'cax11'
const ClusterName = 'talos'

const config = new pulumi.Config()
export const hcloudToken = config.require('hcloud_token')

new hcloud.Provider('hcloud', {
  token: hcloudToken
})


// Basic Infra
const controlPlaneLb = new hcloud.LoadBalancer('control-plane-lb', {
  name: "control-plane",
  loadBalancerType: 'lb11',
  location: "fsn1",
})
const controlPlaneLbId = controlPlaneLb.id.apply(a => parseInt(a))
new hcloud.LoadBalancerService('control-plane-lb-service-k8s', {
  loadBalancerId: controlPlaneLb.id,
  listenPort: 6443,
  destinationPort: 6443,
  protocol: 'tcp',
})
new hcloud.LoadBalancerService('control-plane-lb-service-talos', {
  loadBalancerId: controlPlaneLb.id,
  listenPort: 50000,
  destinationPort: 50000,
  protocol: 'tcp',
})
new hcloud.LoadBalancerTarget('control-plane-lb-target', {
  loadBalancerId: controlPlaneLbId,
  labelSelector: "type=controlplane",
  type: "label_selector",
  usePrivateIp: false,
})


// Prepare the Talos Cluster
const controlPlaneEndpoint = controlPlaneLb.ipv4.apply(a => `https://${a}:6443`)
const secrets = new talos.machine.Secrets("secrets", {});

const ConfigPatch = pulumi.all([controlPlaneEndpoint, controlPlaneLb.ipv4]).apply(([endpoint, ip]) => {
  return JSON.stringify({
    machine: {
      kubelet: {
        extraArgs: {
          'rotate-server-certificates': true
        }
      },
      install: {
        disk: "/dev/sda"
      },
      certSANs: [ip]
    },
    cluster: {
      controlPlane: {
        endpoint: endpoint
      },
      apiServer: {
        certSANs: [ip]
      }
    }
  })
})


const controlPlaneConfig = talos.machine.getConfigurationOutput({
  clusterName: ClusterName,
  machineType: "controlplane",
  clusterEndpoint: controlPlaneEndpoint,
  machineSecrets: secrets.machineSecrets,
  configPatches: [
    ConfigPatch,
    JSON.stringify({
      cluster: {
        extraManifests: [
          'https://raw.githubusercontent.com/alex1989hu/kubelet-serving-cert-approver/main/deploy/standalone-install.yaml',
          'https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml'
        ]
      }
    })
  ]
});

const workerConfig = talos.machine.getConfigurationOutput({
  clusterName: ClusterName,
  machineType: "worker",
  clusterEndpoint: controlPlaneEndpoint,
  machineSecrets: secrets.machineSecrets,
  configPatches: [
    ConfigPatch
  ]
})


// servers
const locations = ['fsn1', 'nbg1']
const controlPlanes = []
for (let i = 0; i< 3; i++) {
  const server = new hcloud.Server(`control-plane-${i}`, {
    location: locations[i%locations.length],
    serverType: HetznerInstanceName,
    image: HetznerImageId,
    userData: controlPlaneConfig.machineConfiguration,
    labels: {type: 'controlplane'},
  }, {ignoreChanges: ['userData']})
  controlPlanes.push(server)
}

const workers = []
for (let i = 0; i< 2; i++) {
  const server = new hcloud.Server(`worker-${i}`, {
    location: locations[i%locations.length],
    serverType: HetznerInstanceName,
    image: HetznerImageId,
    userData: workerConfig.machineConfiguration,
    labels: {type: 'worker'},
  }, {ignoreChanges: ['userData']})
  workers.push(server)
}

// apply talos config
const configurationApplies: ConfigurationApply[] = []
controlPlanes.forEach(server => {
  server.name.apply((name) => {
  const apply = new talos.machine.ConfigurationApply(name, {
    clientConfiguration: secrets.clientConfiguration,
    machineConfigurationInput: controlPlaneConfig.machineConfiguration,
    node: server.ipv4Address,
  });
  configurationApplies.push(apply)
  })
})

workers.forEach(server => {
  server.name.apply((name) => {
    const apply = new talos.machine.ConfigurationApply(name, {
      clientConfiguration: secrets.clientConfiguration,
      machineConfigurationInput: workerConfig.machineConfiguration,
      node: server.ipv4Address,
    });
    configurationApplies.push(apply)
  })
})

// finally, bootstrap the frist node
const bootstrap = new talos.machine.Bootstrap("bootstrap", {
  node: controlPlanes[0].ipv4Address,
  clientConfiguration: secrets.clientConfiguration,
}, {
  dependsOn: configurationApplies,
});



export const talosConfig = pulumi.all([secrets.clientConfiguration, controlPlaneLb.ipv4]).apply(([config, lb]) => {
  return `
context: talos
contexts:
  talos:
    endpoints:
      - ${lb} 
    ca: ${config.caCertificate}
    crt: ${config.clientCertificate}
    key: ${config.clientKey}
  `
})

export const kubeConfig = pulumi.all([secrets.clientConfiguration, controlPlanes[0].ipv4Address, controlPlaneLb.ipv4]).apply(([config, node, lb]) => talos.cluster.getKubeconfig({
    node: node,
    endpoint: lb,
    clientConfiguration: config
}));
export const kubeConfigYml = kubeConfig.kubeconfigRaw

import "./k8s"