
* create an ARM-Based snapshot: https://www.talos.dev/v1.7/talos-guides/install/cloud-platforms/hetzner/ (be sure to use the ARM-image! Default is AMD64.raw.xz)
* insert the ID into the index.ts file
```
npm install
pulumi config set hcloud_token --secret
pulumi up

pulumi stack output talosConfig --show-secrets > talosconfig
pulumi stack output kubeConfigYml --show-secrets > kubeconfig

export KUBECONFIG=./kubeconfig
export TALOSCONFIG=./talosconfig
```
Then, give the cluster time to bootstrap. 2-5 minutes, you can check the progress in the hetzner console.

```
kubectl get nodes
```

* Set IsBootstrapped = true
* run `pulumi up` again