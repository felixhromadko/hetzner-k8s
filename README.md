
## 01-infrastructure
> creates basic servers, talos cluter, k8s bootstrap
* create an ARM-Based snapshot: https://www.talos.dev/v1.7/talos-guides/install/cloud-platforms/hetzner/ (be sure to use the ARM-image! Default is AMD64.raw.xz)
* insert the ID into the src/01-infrastructure.ts file
```
npm install

cd src/01-infrastructure
pulumi config set hcloud_token --secret
pulumi up

pulumi stack output talosConfig --show-secrets > talosconfig
pulumi stack output kubeConfigYml --show-secrets > kubeconfig

export KUBECONFIG="$PWD/kubeconfig"
export TALOSCONFIG="$PWD/talosconfig"
```
Then, give the cluster time to bootstrap. 2-5 minutes, you can check the progress in the hetzner console.

```
kubectl get nodes
```

## 02-k8s-defaults
> Hetzner-CSI, Project-contour reverse proxy

TODO: SSL with let's encrypt

```
cd src/02-k8s-defaults
pulumi up

write down the httpIngressIp
```

## 03-k8s-test
> Two test applications to test the CSI (volumes) and ReverseProxy

```
cd src/03-k8s-test
pulumi up
```

* You can test the csi using the shell on the stateful pod
* You can test the reverse proxy using the HttpIngressIp in the browser