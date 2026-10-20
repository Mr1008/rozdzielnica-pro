# CodeArtifact Registry Terraform — Requirements

> **AWS appendix for Model 2.** This spec describes a private npm registry as
> managed cloud infrastructure: AWS CodeArtifact + Terraform. Start with the
> GitHub Packages specs unless your team already needs AWS-native governance.

## Goal
Create AWS infrastructure for a private npm registry using Terraform.

## Configuration

| Parameter | Value |
|-----------|-------|
| Domain name | `devs10x` (must start with a lowercase letter) |
| AWS region | `eu-central-1` |
| S3 state bucket | `<your-terraform-state-bucket>` (create it first; bucket names are global) |
| State key | `codeartifact/terraform.tfstate` |
| Private repo name | `npm` |
| Proxy repo name | `npm-store` |
| External connection | `public:npmjs` |
| Project name | `<your-project-name>` |
| AWS account id | `<your-account-id>` |

## Terraform versions
- Terraform required version: `>= 1.10`
- AWS provider version: `~> 6.0`
- S3 backend locking: `use_lockfile = true` (native S3 locking, no DynamoDB needed)

## Tags
- `Project`: `<your-project-name>`
- `ManagedBy`: `terraform`
- `Environment`: `<your-environment>` (e.g. `dev`)

## KMS
- Key alias: `alias/devs10x-codeartifact`

## IAM managed policy
- Policy name: `devs10x-codeartifact-developer`
- Permissions: domain auth, repository read, package publish
- Attach to existing CI/CD role via `aws_iam_role_policy_attachment`

## GitHub Actions role
- Role name: `github-actions-codeartifact` (pre-existing, referenced via `data` source)
- The managed policy is attached to this role so CI/CD can authenticate to CodeArtifact

## tfvars example
```hcl
aws_region     = "eu-central-1"
domain_name    = "devs10x"
aws_account_id = "<your-account-id>"
project_name   = "<your-project-name>"
```

## Scoped login — known gotcha
A scoped login routes only your package scope through CodeArtifact and leaves
everything else on public npm:

```bash
aws codeartifact login --tool npm --domain devs10x --repository npm --namespace 10xdevs
```

`--namespace` takes the package scope without the `@` (`10xdevs`), not the
CodeArtifact domain (`devs10x`). These are two different things:
package scope `@10xdevs` != domain `devs10x`.
