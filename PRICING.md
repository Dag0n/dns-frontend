# DNS Hosting Cost Comparison — 850 Parish Domains

Estimated monthly costs for hosting `anglican.org` with ~850 parish
subdomains under the app's **single-zone architecture** (one zone, all
parish records inside it). Prices checked August 2026 — always verify
against the providers' pricing pages before committing.

## Assumptions

**Zone size:** 850 parishes × ~15–25 records each (A/AAAA, www, MX,
SPF/DKIM/DMARC TXT, occasional SRV/CAA) + apex records ≈ **~17,000 records
in one zone**.

**Query volume** — what actually hits the authoritative servers after
resolver caching:

| Source of queries | Per parish / day | Notes |
|---|---|---|
| Web lookups (A/AAAA, www CNAME) | ~300–1,500 | small parish sites; resolvers cache per TTL |
| Email: MX + SPF + DKIM + DMARC | ~200–1,000 | every inbound mail (incl. spam) triggers lookups, but Gmail/Outlook cache heavily |
| Other (NS, misc, monitoring) | ~50–200 | |

That gives roughly **500–2,500 queries/day per parish**, so for 850:

| Scenario | Total queries / month |
|---|---|
| Low | ~15 million |
| **Expected** | **~40 million** |
| High (spam waves, popular events e.g. Easter/Christmas) | ~120 million |

> TTL tuning matters: most parish records rarely change. Raising TTLs from
> 3600s to 86400s roughly halves authoritative query volume — the tables
> below use untuned volumes.

## Unit pricing

| Provider | Zone fee | Queries | Records per zone | Notes |
|---|---|---|---|---|
| **Amazon Route 53** | $0.50/zone/mo | $0.40 per million (first 1B) | 10,000 included, then **$0.0015/record/mo** | our ~17k records ⇒ ~7k × $0.0015 ≈ $10.50/mo extra |
| **Google Cloud DNS** | $0.20/zone/mo | $0.40 per million (first 1B) | 10,000 default quota — free increase on request | cheapest zone fee |
| **Azure DNS** | $0.50/zone/mo (first 25) | $0.40 per million (first 1B) | 10,000 (quota increase on request) | functionally similar to the others |
| **Cloudflare** | $0 (Free) / $20–25 (Pro) / $200 (Business) | **$0 — unmetered on all plans** | **Free: 200** (zones created after Sep 2024) / Pro & Business: 3,500 / Enterprise: account-level 1M | ⚠ at ~17k records, only **Enterprise** (custom pricing, typically $1000s/yr) fits |
| **Hurricane Electric** (current `main` design) | $0 | $0 | not formally published; large slaved zones are normal | secondary/AXFR of our hidden master; free service |

## Estimated monthly cost at each scenario

Single zone, ~17,000 records:

| Provider | Low (15M q/mo) | **Expected (40M q/mo)** | High (120M q/mo) |
|---|---|---|---|
| Amazon Route 53 | ~$17 | **~$27** | ~$59 |
| Google Cloud DNS | ~$6 | **~$16** | ~$48 |
| Azure DNS | ~$7 | **~$17** | ~$49 |
| Cloudflare Enterprise | custom — typically thousands per year regardless of volume | ← | ← |
| Cloudflare Free/Pro/Business | **not possible** — 200 / 3,500 record caps | ← | ← |
| Hurricane Electric + own VPS (`main`) | $0 DNS | **$0 DNS** | $0 DNS — but ⚠ **10k records/zone purge cap**, see below |

All options additionally need the app VPS (~$5–8/mo) and the domain
registration (~$10–30/yr) — identical across providers, so excluded.

## Fit with this codebase

- **Hurricane Electric** (`main` branch): zero DNS cost; you operate
  PowerDNS as hidden master. The cost is operational, not monetary.
  **Hard limit:** HE's free service purges slave zones exceeding **10,000
  records** (stated on the zone page; the add-slave form separately caps at
  100k). At ~15–25 records/parish the single-zone design hits that at
  roughly **400–650 parishes** — fine for staging and a pilot, not for full
  scale. Escape routes, in rough order of preference:
  1. **Split into per-diocese zones** (e.g. `oxford.anglican.org` as its
     own slaved zone): ~42 dioceses × 10k records fits easily inside HE's
     50-zone account limit and stays $0, but the app must grow multi-parent
     support (today it assumes exactly one parent zone).
  2. **Paid AXFR secondary** (ClouDNS, DNS Made Easy, etc., ~$5–30/mo):
     keeps the hidden-master architecture completely unchanged — just
     different `allow-axfr-ips`/`also-notify` IPs and NS records.
  3. **Switch to an API provider** from the table above via a new ~250-line
     adapter (see the Route 53 / Google / Azure bullet below).
- **Cloudflare** (`cloudflare` branch): the adapter is built and tested,
  but at 850-parish scale the record caps force an Enterprise conversation.
  Two ways it can still make sense: Cloudflare's **nonprofit/Project
  Galileo** programs (worth an application — a church network may qualify
  for free upgraded plans), or negotiating Enterprise DNS-only pricing.
- **Route 53 / Google Cloud DNS / Azure DNS**: no adapter yet, but each
  would be the same shape as `cloudflare.js` (~250 lines implementing
  ensureZone / getParentRrsets / patchParent against their APIs) since the
  app's whole DNS surface is those three operations. All three comfortably
  fit 17k records and cost **$15–30/mo at expected volume**.

## Bottom line

| If you want... | Choose |
|---|---|
| Lowest cost, control, already built | Hurricane Electric + hidden master (`main`) — $0 |
| Managed, predictable, cheap, no DNS servers to run | Google Cloud DNS (~$16/mo) or Azure/Route 53 (~$17–27/mo) — needs a small adapter like the Cloudflare one |
| Cloudflare's network + unmetered queries | Only via Enterprise or a granted nonprofit plan |

## Sources

- [Cloudflare DNS features and plan limits](https://developers.cloudflare.com/dns/reference/all-features/)
- [Cloudflare account-level DNS record quota (Enterprise)](https://developers.cloudflare.com/changelog/post/2026-06-10-account-level-record-quota/)
- [Amazon Route 53 pricing](https://aws.amazon.com/route53/pricing/)
- [Google Cloud DNS pricing](https://cloud.google.com/dns/pricing) *(verify — quoted from documentation knowledge)*
- [Azure DNS pricing](https://azure.microsoft.com/en-us/pricing/details/dns/) *(verify — quoted from documentation knowledge)*
