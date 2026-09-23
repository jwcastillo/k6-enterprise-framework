# FinOps and cloud cost optimization

Performance engineering's financial twin. Use when the engagement involves cloud cost reduction, cost-perf trade-off decisions, multi-cloud cost allocation, or AI/LLM cost management. Covers AWS, Azure, GCP, Kubernetes, and AI workloads through a PE engineer's lens.

This complements (not replaces) `runtime-perf-tuning.md`, `runtimes-on-kubernetes.md`, and `llm-perf-and-tokens.md` — those optimize for performance; this optimizes the cost-perf joint surface.

---

## The FinOps perspective for PE engineers

PE engagements often surface cost decisions: "should we add 10 more pods?" "switch to a bigger instance?" "buy reserved capacity?" Without FinOps discipline, these decisions are made on intuition and end up under-optimizing on both axes.

**Core principle**: cost without perf is irresponsible architecture; perf without cost is unsustainable architecture. PE engineers contribute the perf axis; FinOps engineers contribute the cost axis; mature engagements bring both.

### FinOps Foundation Framework 2026 (current as of May 2026)

Key updates from 2025 → 2026:

| Capability | Change |
|------------|--------|
| **Usage Optimization** (formerly Workload Optimization) | Renamed to reflect scope across all FinOps domains, not just cloud workloads |
| **Executive Strategy Alignment** | NEW capability — formalizes connection between FinOps and executive decision-making |
| **Architecting & Workload Placement** (formerly Architecting for Cloud) | Renamed for multi-tech scope (cloud + data center + SaaS) |
| **Sustainability** (formerly Cloud Sustainability) | Broader scope |
| **Governance, Policy & Risk** (formerly Policy & Governance) | Risk dimension added |
| **Automation, Tools & Services** (formerly FinOps Tools & Services) | Three-category framing for solution evaluation |
| **KPI & Benchmarking** (formerly Benchmarking) | Standardized KPI sets |

**2026 reality**: 98% of FinOps teams now manage AI spend (up dramatically). 78% report to CTO/CIO (not CFO) — signaling FinOps as an engineering capability, not a finance function. "We've hit the big rocks of waste" — diminishing returns on traditional cloud cost optimization; AI workloads drive the new wave.

### FOCUS — FinOps Open Cost and Usage Specification

FOCUS is the emerging standard for normalized billing data across providers (AWS CUR, Azure Cost Mgmt, GCP Billing, SaaS bills). When FOCUS-compatible data is available, cross-cloud analysis becomes practical without provider-specific schema munging.

**For PE engagements**: ask if the org has FOCUS data exports. If yes, the cost analysis layer is solvable; if not, you'll be doing per-provider work and that's fine — just longer.

---

## The FinOps + perf joint discipline

State both metrics on every recommendation:

> *"Switching from r6g.xlarge to r7g.large saves $X/month but adds ~30ms p99 due to lower clock speed. Net impact: $X savings vs SLO budget of Y ms. Approve?"*

Single-axis decisions are the most common engagement failure mode:
- "We saved $50k/month" without measuring the latency regression → SLO breach next quarter
- "We hit our p99 target" by upsizing everything → cost doubles, finance pulls the plug
- "We use spot instances" → tail latency variance breaks the SLO

### Cost-perf decision matrix

| Decision | Cost lever | Perf lever | Both axes |
|----------|------------|------------|-----------|
| Instance family change | $ saved/month | Δ p99 latency, Δ throughput | Cost per req at SLO |
| Reserved/committed capacity | % discount × commitment | None (same hardware) | TCO over commitment period |
| Spot/preemptible | 50-90% discount | Variance + interruption risk | SLO breach probability × cost |
| Auto-scaling tuning | $ saved on overprovisioning | Δ cold start latency | p99 during scale-up |
| Storage tier change | $ saved per GB | Δ access latency | Access latency × access frequency |
| Database tier change | $ saved per query/storage | Δ query latency, Δ throughput | TPS at p99 SLO |
| Multi-region → single-region | $ saved on data transfer | Δ latency for distant users | User experience cost |

Always state the trade-off. PE engineer who only says "cheaper is better" is doing FinOps wrong; FinOps engineer who only says "p99 is the target" is doing PE wrong.

---

## Universal optimization patterns (cloud-agnostic)

### Tagging / labeling strategy

Without tags, **nothing is attributable**, and FinOps degrades to "lower the total bill" guesswork.

**Minimum tag set:**

| Tag | Purpose |
|-----|---------|
| `environment` | prod / staging / dev / sandbox |
| `team` or `owner` | accountability |
| `service` or `application` | per-product unit economics |
| `cost-center` | financial chargeback |
| `feature` or `experiment` | which AI/feature flag drives this spend |
| `customer` (B2B) | per-customer profitability |

**Enforcement**: tag policies should be enforced at provisioning time (via IaC, AWS Service Control Policies, Azure Policy, GCP Org Policy). Retro-tagging is expensive and rarely complete.

### Right-sizing workflow

1. **Collect 14-30 day usage data** (CPU, memory, network, IOPS, GPU utilization)
2. **Find underutilized resources** (p95 utilization < 40% for week)
3. **Categorize**: candidate for downsize, candidate for scheduling (dev/test only), candidate for termination (zombie)
4. **Validate against perf data**: does the workload have spikes the 14-day window missed? Seasonal patterns?
5. **Propose change with cost-perf joint statement**
6. **Implement in staging first**; monitor 1-2 weeks before prod
7. **Tag the change** with right-sizing campaign ID for ROI tracking

**Anti-patterns:**
- Right-sizing based on instantaneous metrics (you'll catch idle minutes; miss the 3am batch job)
- Right-sizing without rollback plan (workload changes, instance is gone)
- Mass-applying recommendations without per-workload validation

### Idle resource detection

Common waste sources:
- **Unattached volumes / disks** — survived instance termination
- **Idle load balancers** — created but not routing traffic
- **Stale snapshots** — replaced by newer ones, never deleted
- **Old data egress paths** — legacy peering / NAT charges
- **Inactive accounts/projects** — entire workloads abandoned but billed
- **Dev/test environments running 24/7** — schedule shutdown nights/weekends → 70% reduction
- **Unused IPs, NAT gateways, firewalls** — surprisingly expensive at scale

Each cloud has detection tools (covered per-cloud below). For PE engineers: run these reports as part of any infra perf engagement — finding $50k/month of idle waste is a frequent side win.

### Egress / data transfer optimization

Cross-AZ, cross-region, and internet egress are **expensive everywhere**. Common findings:

- Services in different AZs gossiping heavily → consolidate or use VPC endpoints
- Logs / metrics streaming across regions → aggregate locally first
- S3 reads from wrong region → align compute and storage regions
- Cross-cloud chatty integration → batch + compress
- Backup/replication across regions for non-DR data → reconsider RTO/RPO

### Storage lifecycle policies

Storage costs decay 10-100× from hot tier to cold tier. Apply lifecycle rules:

| Tier | When |
|------|------|
| Hot (Standard) | Active read/write, <30 days old typically |
| Warm (IA / Cool / Nearline) | Accessed monthly, recent backups |
| Cold (Glacier / Archive / Coldline) | Quarterly+ access, long-term backups, compliance archives |
| Deep cold (Deep Archive / Archive Tier) | Annual access, regulatory retention |

**Critical**: validate retrieval cost and latency before moving data. Glacier retrieval can cost more than a year of Standard storage if you're frequently accessing it.

---

## AWS-specific

### Compute commitments (in order of preference)

| Option | Discount | Flexibility | When |
|--------|----------|-------------|------|
| **Compute Savings Plans** | Up to 66% | Across instance family + region + OS | Most workloads; default choice |
| **EC2 Instance Savings Plans** | Up to 72% | Within instance family + region | When you're committed to a specific family |
| **Reserved Instances (Standard)** | Up to 72% | Within specific instance type | Legacy; SPs usually win now |
| **Reserved Instances (Convertible)** | Up to 54% | Can exchange for different RI | Less common |
| **Spot Instances** | Up to 90% | Can be reclaimed | Fault-tolerant workloads, batch, training |
| **On-Demand** | Baseline | Full flexibility | Burst, dev, untested workloads |

**Rule of thumb**: commit at the **floor** of your sustained usage (the workload you're certain will run for the commitment term), not the peak. Cover bursts with on-demand or spot.

**Spot strategy** for production:
- Mixed instance type policies (multi-family fleet) reduce interruption probability
- Use ASG capacity-optimized allocation
- Architect for graceful interruption (checkpointing, SQS retry, etc.)
- For EKS: Karpenter + Spot is the modern stack

### S3 storage classes

| Class | Use |
|-------|-----|
| **S3 Standard** | Active data, frequent access |
| **S3 Intelligent-Tiering** | Variable access patterns — auto-tiering |
| **S3 Standard-IA** | Monthly access, large objects |
| **S3 One Zone-IA** | Re-creatable data, monthly access |
| **S3 Glacier Instant Retrieval** | Quarterly access, milliseconds retrieval |
| **S3 Glacier Flexible Retrieval** | Backups, minutes-to-hours retrieval |
| **S3 Glacier Deep Archive** | Annual access, regulatory retention, 12h retrieval |

**Intelligent-Tiering as default for "unknown access pattern" data** — minimal monitoring overhead, auto-tiers between Standard and IA without retrieval fees.

### Other AWS levers

- **EBS volumes**: gp3 over gp2 (cheaper baseline + provision IOPS separately)
- **RDS**: reserved capacity, gp3 storage, choose right instance family (r-series for memory-heavy, m-series for balanced)
- **Aurora**: Aurora I/O-Optimized vs standard — break-even at ~25% I/O cost; analyze first
- **DynamoDB**: on-demand vs provisioned with auto-scaling — provisioned wins above ~70% utilization
- **Lambda**: ARM (Graviton2) for ~20% discount, larger memory for faster execution (often cheaper per-execution)
- **NAT Gateway** vs **VPC endpoints** for AWS service traffic — endpoints save egress at scale
- **CloudFront** for static + dynamic content offload — drops origin egress and adds caching
- **Trusted Advisor cost checks** + **Cost Anomaly Detection** + **Cost Explorer recommendations** — always enable, always review monthly

### EKS-specific

- **Karpenter** over Cluster Autoscaler — bin-packs better, faster scale-up, native spot support
- **Spot for stateless workloads** with PDB tuning
- **Graviton (ARM) nodes** for compatible workloads — 20% savings, often faster on perf benchmarks
- **Right-size requests/limits** via VPA recommendations (read-only mode); validate p95 in staging before applying
- **Idle/over-provisioned pods**: Goldilocks tool for visualization; remove specifically before scaling cluster

---

## Azure-specific

### Compute commitments

| Option | Discount | Flexibility |
|--------|----------|-------------|
| **Azure Savings Plans for compute** | Up to 65% | Across VM family + region |
| **Azure Reserved Instances** | Up to 72% | Specific VM family |
| **Azure Spot VMs** | Up to 90% | Can be evicted |
| **Pay-as-you-go** | Baseline | Full flexibility |

### Azure Hybrid Benefit

If the org has on-prem Windows Server / SQL Server licenses (Software Assurance), AHB applies them in Azure: up to 85% off compared to PAYG. Many enterprises leave this on the table — surface it in audits.

### Storage tiers

| Tier | Use |
|------|-----|
| **Hot** | Frequent access |
| **Cool** | Infrequent (30+ days old) |
| **Cold** | Rare (90+ days, recovery time minutes) |
| **Archive** | Rare (180+ days, recovery time hours) |

### Database tiers

- **Azure SQL Database** — DTU model vs vCore; vCore for predictable workloads; serverless for sporadic
- **Cosmos DB** — autoscale RU/s with min provisioned floor for predictable workloads
- **Synapse / Fabric** — pause when not querying; massive savings vs always-on

### AKS-specific

- **Cluster Autoscaler** + **VM Scale Sets with Spot priority**
- **Spot node pools** for batch, dev, fault-tolerant production
- **AKS Cost Analysis** view (built-in to Azure Cost Management) — per-namespace breakdown

### Other Azure levers

- **Azure Cost Management + Billing** dashboards and budgets
- **Advisor cost recommendations** — auto-collected, surface in reviews
- **Reserved IPs for production**, dynamic for dev (vs always reserving)
- **Azure Functions** — Consumption plan for low-volume, Premium for predictable

---

## GCP-specific

### Compute commitments

| Option | Discount | Flexibility |
|--------|----------|-------------|
| **Committed Use Discounts (CUDs)** | Up to 70% | Resource-based (1y / 3y) |
| **Sustained Use Discounts (SUDs)** | Automatic, up to 30% | Automatic on running instances |
| **Spot VMs** | 60-91% | Can be preempted, 30s notice |
| **On-Demand** | Baseline | Full flexibility |

### Cloud Storage classes

| Class | Use |
|-------|-----|
| **Standard** | Frequent access |
| **Nearline** | Monthly access, 30-day minimum |
| **Coldline** | Quarterly access, 90-day minimum |
| **Archive** | Annual access, 365-day minimum |

### BigQuery cost model — critical for analytics workloads

| Model | When |
|-------|------|
| **On-demand** ($/TB processed) | Sporadic queries, < TB-scale workloads |
| **Capacity (slot reservations)** | High-volume, predictable workloads |
| **Editions** (Standard/Enterprise/Plus) | Compliance / regional / advanced features tier |

For BigQuery: clustering and partitioning are free perf+cost wins. Always partition tables on a date column when applicable.

### GKE-specific

- **GKE Autopilot** — Google manages the nodes, charge per pod resource. Higher per-pod cost but no idle node waste; often cheaper for variable workloads
- **GKE Standard with spot pools** — traditional model, more control
- **Cluster Autoscaler + Spot VMs**
- **Workload Identity** instead of node-level service accounts — security + cost (avoid duplicate IAM)

### Other GCP levers

- **Cloud Run** instead of always-on GKE for low-volume HTTP services — pay per request, scales to zero
- **Cloud Functions** for true serverless
- **Recommender API** — collects ML-driven recommendations (idle VMs, oversized VMs, idle GPUs)
- **Active Assist** as a category — covers Recommender + Policy Analyzer + others

---

## Kubernetes FinOps (cloud-agnostic)

K8s introduces a shared resource model — multiple workloads on shared nodes. This breaks naive per-resource cost attribution. FinOps tools step in:

| Tool | What it does |
|------|--------------|
| **OpenCost** | Open-source K8s cost allocation (now CNCF) — per-namespace / pod / label cost from cloud bill |
| **Kubecost** | Commercial wrapper on OpenCost with enterprise features (multi-cluster, alerts, optimization recs) |
| **Karpenter** (AWS) | Just-in-time node provisioning replacing Cluster Autoscaler |
| **KEDA** | Event-driven autoscaling — scale on queue depth, RPS, custom metrics (vs just CPU/memory) |
| **Goldilocks** | VPA recommendation visualizer for right-sizing pods |
| **kube-resource-report** | Quick fleet-wide resource utilization view |

### K8s cost optimization workflow

1. **Install OpenCost / Kubecost** — get per-namespace cost visibility
2. **Tag/label discipline** — `app`, `team`, `env` labels on every workload
3. **Right-size pods**: requests should match p95 actual usage; limits should match p99 + safety
4. **Bin-pack better**: use Karpenter (AWS) or equivalent; consolidate small pods on fewer nodes
5. **Scale to zero** where possible: dev/test environments off-hours; queue-driven workloads at idle
6. **Spot/preemptible** for fault-tolerant workloads
7. **Vertical Pod Autoscaler in recommendation mode**: collect data; don't auto-apply
8. **Idle GPU detection**: GPU-attached pods with low utilization are the most expensive waste in modern clusters

### Common K8s cost anti-patterns

- **Requests = limits = peak observed** → pays for unused headroom 24/7
- **No requests set** → kubelet best-effort, no scheduling guarantees, eviction risk
- **One pod per node** (limit too high for node) → bin-packing collapse
- **Cluster autoscaler never scales down** → check PodDisruptionBudgets, node taints
- **Idle GPUs** on training pods that finished but didn't terminate
- **CronJobs without resource limits** → memory leak in a CronJob fills nodes
- **EmptyDir volumes accumulating** → can cause node disk pressure → eviction storm

---

## AI / LLM workload FinOps

The 2026 reality: 98% of FinOps teams now manage AI spend. New patterns specific to AI:

### Token-level attribution

Standard cloud cost tools don't break down LLM API costs by prompt / user / feature. Two approaches:

1. **Wrapper at the application layer** — log every API call with metadata (user, feature, prompt template version) + token counts + cost
2. **Specialized tools** — CloudZero, Helicone, Langfuse have AI-cost-specific features

Without per-call attribution, you can't tell which feature is driving the bill — leadership conversations are guesswork.

### Cost-per-unit-of-work as KPI

For LLM features, the cost metric isn't "$/month" — it's:

- **Cost per inference** (for chat, completion, embeddings)
- **Cost per token** (input separately from output)
- **Cost per customer interaction** (the business unit)
- **Cost per task completed** (for agentic workflows)

These tie spend to business value. Hard to manage spend you can't attribute.

### LLM optimization techniques (cost angle)

Same techniques as in `llm-perf-and-tokens.md`, viewed through cost:

| Technique | Cost impact |
|-----------|-------------|
| Prompt caching | ~90% reduction on cache reads (huge ROI) |
| Batch API | 50% discount on non-interactive workloads |
| Model tier selection | 5-10× cost difference between tiers |
| Two-stage pipelines (Haiku filter → Sonnet/Opus) | 70-90% reduction on high-volume tasks |
| RTK / response compression | Indirect — fewer input tokens = lower cost |
| RAG vs full context | Embedding cost amortized vs per-call full context |
| Streaming | No cost change; UX improvement |

### Infrastructure for AI workloads

For self-hosted LLMs or GPU training/inference workloads:

- **GPU selection**: H100 vs A100 vs L40S vs L4 — match to workload (training needs H100; inference often fine on L4/L40S)
- **Spot for training**, on-demand for production inference
- **Cold start matters more**: GPU images are large, cold start hurts; pre-warming or always-on minimums for production
- **ARM/Graviton for non-GPU AI workloads** (data prep, orchestration, vector stores) — significant savings
- **Inferentia / TPU for model-specific deployment** — discounts vs equivalent GPU, but lock-in trade-off
- **Edge inference** for latency-critical (Cloud Run / Lambda@Edge / Cloudflare Workers AI)

### AI FinOps governance pattern

The "self-fund AI" pattern (FinOps Foundation 2026): organizations require AI investments to be funded from optimization savings elsewhere. This makes FinOps + AI a strategic priority.

When an engagement involves AI cost: lead with the **self-fund framing**. "If we can save $X on traditional cloud waste, we can fund $X of AI experimentation without new budget." Executives like this.

---

## Multi-cloud cost normalization

For orgs running > 1 cloud:

- **FOCUS spec adoption** — normalizes billing schemas; aim for this where possible
- **Cross-cloud cost analysis tools**: CloudHealth (VMware Aria), Apptio Cloudability, Flexera, Vantage, CloudZero, Anodot, Datadog Cloud Cost Management
- **Open-source**: OpenCost (K8s-focused), Komiser, Infracost (Terraform-time costing)
- **Cost-aware Terraform**: Infracost in CI pipeline — surface cost diff on every PR

For PE engagements: Infracost integration in CI is one of the highest-ROI cost-control measures. Cost regressions get caught at PR review time, not at month-end.

---

## Tools landscape — quick reference

### Cloud-native

| Cloud | Cost tools |
|-------|-----------|
| AWS | Cost Explorer, Cost Anomaly Detection, AWS Budgets, Trusted Advisor, Compute Optimizer |
| Azure | Cost Management + Billing, Advisor, Reservation recommendations |
| GCP | Billing reports, Recommender, Active Assist, BigQuery slot recommender |

### Open-source

| Tool | What |
|------|------|
| **OpenCost** | K8s cost allocation (CNCF) |
| **Infracost** | Terraform cost estimation in CI |
| **Komiser** | Multi-cloud resource visualizer + cost |
| **Kubecost (free tier)** | K8s cost optimization |

### Commercial (broader scope)

| Tool | Strengths |
|------|-----------|
| **CloudHealth / VMware Aria** | Enterprise, mature multi-cloud |
| **Apptio Cloudability** | Enterprise FinOps with strong reporting |
| **Vantage** | Modern UI, fast onboarding, strong AWS focus |
| **CloudZero** | Unit-economics focus, AI cost features |
| **Cast AI** | K8s automation: continuous right-sizing, Spot fallback |
| **Spot.io / Spot by NetApp** | Multi-cloud Spot management |
| **Datadog Cloud Cost Management** | Tight integration with Datadog observability stack |
| **Flexera (formerly RightScale)** | Enterprise governance + cost |

### LLM/AI-specific cost

| Tool | What |
|------|------|
| **Helicone** | LLM observability + cost attribution |
| **Langfuse** | Open-source LLM observability + cost |
| **PromptLayer** | Prompt management + cost tracking |
| **LangSmith** | (LangChain ecosystem) traces + cost |

---

## FinOps engagement workflow

When entering a FinOps-focused PE engagement:

### Week 1 — Inform (visibility)

1. Get billing data access (cloud console, FOCUS export if available)
2. Establish tagging baseline — what % of spend is tagged? Untagged spend is the first target
3. Build per-team / per-service / per-environment breakdown
4. Identify top 10 cost line items — usually 80% of spend is in top 10

### Week 2-3 — Optimize (easy wins)

1. **Idle resource cleanup** — surveyed snapshots, unattached volumes, idle LBs, abandoned projects
2. **Right-size obvious oversizing** — VMs at < 20% p95 CPU for 30 days
3. **Storage lifecycle** — apply tiering to old data
4. **Dev/test scheduling** — shutdown nights/weekends
5. **Surface savings plans / RI opportunities** — but commit needs leadership sign-off

These typically deliver 15-30% reduction without architectural change. Build credibility before harder asks.

### Week 4+ — Optimize (architectural)

1. **Spot/preemptible adoption** — workload by workload
2. **Storage class migration** — measured access patterns
3. **Architectural changes** — caching layers, region consolidation, instance family migration
4. **K8s right-sizing** — VPA recommendations validated and applied
5. **AI cost optimization** — apply patterns from `llm-perf-and-tokens.md` to LLM-using workloads

### Ongoing — Operate (governance)

1. **Tagging enforcement** at provisioning time
2. **Cost dashboards** per team/service (developer-facing)
3. **Budget alerts** on anomalies
4. **PR-time cost diff** via Infracost
5. **Monthly review cadence** with stakeholders
6. **Quarterly commitment review** (RIs, SPs, CUDs) — track utilization, plan renewals

---

## Anti-patterns

- **Tackling cost without measuring perf** — saves $50k, breaks SLO, costs $200k in churn
- **One-shot optimization without ongoing process** — gains erode within 6 months
- **Untagged spend treated as "the cloud team's problem"** — actually a process problem
- **Aggressive RI commitments before usage stabilizes** — locks in oversizing for 1-3 years
- **Spot everywhere without graceful interruption** — production outages
- **Right-sizing dev/test like prod** — wrong workloads for the discipline
- **AI cost as separate FinOps practice** — should be integrated, not bolted on
- **"Cloud is too expensive, let's repatriate"** — sometimes right, often wrong; do the math with full TCO including ops labor
- **Single metric obsession** ($/month dropped) — without unit economics this means nothing

---

## When to bring in a specialized FinOps team

PE engineers can lead on technical optimizations. Bring in dedicated FinOps for:

- **Multi-year commitment planning** (millions of dollars, regulatory implications)
- **Chargeback / showback design** (organizational change)
- **Vendor negotiation** (EDP discounts, custom pricing)
- **FOCUS rollout** at enterprise scale
- **Compliance-driven cost segregation** (sovereign cloud, data residency cost optimization)
- **AI strategy economics** (build vs buy vs API for foundational AI infrastructure)

---

## Honest scope notes

- **This is a PE-engineer's perspective on FinOps**, not a FinOps Foundation textbook. For deeper FinOps practice — certification, framework, organizational design — see https://www.finops.org
- **Pricing changes frequently** — always verify current prices via cloud provider docs before recommendations. Verify Savings Plan / RI terms against current offerings.
- **Tools list is illustrative** — vendor landscape moves quickly. Evaluate against current state, not this list.
- **Multi-cloud parity is approximate** — AWS / Azure / GCP differ in details; FOCUS spec is bridging this but not yet uniform.
- **AI FinOps is rapidly evolving** — patterns established in 2025-2026; expect significant evolution.
