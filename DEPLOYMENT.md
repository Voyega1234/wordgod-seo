# Deploy WordGod to Vercel with Google Cloud OIDC

The application no longer uses `GEMINI_API_KEY`. Gemini requests go through
Vertex AI using short-lived credentials exchanged from Vercel OIDC.

Gemini calls are labeled for Vertex AI billing reports with:

```text
project=wordgod
component=gemini
function=<pipeline_stage>
environment=<production|preview|development>
```

The `function` label is intentionally low-cardinality, for example
`keyword_research`, `seo_title_generation`, `problem_discovery`, and
`topic_clustering`.

## 1. Configure Google Cloud

1. Enable the Vertex AI API, Security Token Service API, and IAM Service Account Credentials API.
2. In **IAM & Admin -> Workload Identity Federation**, create a pool and an OIDC provider.
3. Use the Vercel team issuer: `https://oidc.vercel.com/TEAM_SLUG`.
4. Map `google.subject` to `assertion.sub`.
5. Create a service account and grant it **Vertex AI User** (`roles/aiplatform.user`).
6. Grant the Vercel workload principal **Workload Identity User** on that service account.

For production, the principal subject is:

```text
owner:VERCEL_TEAM:project:VERCEL_PROJECT:environment:production
```

Repeat the binding for `preview` or `development` only if those environments
need Vertex AI access.

## 2. Choose the provider audience

Recommended: select **Default audience** in the GCP provider and copy its URL
into `GCP_AUDIENCE`. The value has this form:

```text
https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID
```

Alternatively, configure the provider's allowed audience as
`https://vercel.com/TEAM_SLUG` and leave `GCP_AUDIENCE` unset.

## 3. Configure Vercel

Import the repository in Vercel and add these environment variables:

```text
GCP_PROJECT_ID
GCP_PROJECT_NUMBER
GCP_SERVICE_ACCOUNT_EMAIL
GCP_WORKLOAD_IDENTITY_POOL_ID
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
GCP_AUDIENCE
GCP_LOCATION=global
AUTH_PASSWORD
```

Set `AUTH_PASSWORD` to protect the deployed application. Add the optional
DataForSEO and Google Ads variables from `.env.example` only when those
integrations are needed. Do not add `GEMINI_API_KEY`.

In **Vercel Project -> Settings -> Security -> Secure backend access with OIDC**,
use **Team issuer mode** so it matches the issuer configured in GCP.

## 4. Local development

Link the project and pull a development OIDC token:

```bash
vercel link
vercel env pull .env.local
npm run dev
```

The development subject also needs a matching Workload Identity User binding
in GCP. `@vercel/oidc` refreshes an expired development token through the
linked Vercel CLI session.

## 5. Deploy

```bash
npm ci
npm run build
vercel --prod
```
