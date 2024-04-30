
* create an ARM-Based snapshot: https://www.talos.dev/v1.7/talos-guides/install/cloud-platforms/hetzner/ (be sure to use the ARM-image! Default is AMD64.raw.xz)
* insert the ID into the index.ts file
```
export HCLOUD_TOKEN="..."
pulumi up

pulumi stack output talosConfig --show-secrets > talosconfig
pulumi stack output kubeConfigYml --show-secrets > kubeconfig

export KUBECONFIG=./kubeconfig
export TALOSCONFIG=./talosconfig

kubectl get nodes
```