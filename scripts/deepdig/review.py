# Print the review table for an area's verified targets: python3 review.py <area> <verified.csv>
import json,csv,sys,os
PROJECT=os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..'))
area, f = sys.argv[1], sys.argv[2]
s=json.load(open(f'{PROJECT}/out/logs/verify-{area}.json'))
rows={r['place_id']:r for r in csv.DictReader(open(f))}
for pid,v in s.items():
    r=rows.get(pid)
    if not r or 'summary' not in v: continue
    m=v['summary']
    print(f"\n### {r['name']} [{r['city']}] {r['pos']}/{r['pos_confidence']} ph={r['phone']} web={r['website']} pid={pid}")
    print(f"  live: {m['pos_checked_live'][:200]}")
    print(f"  phone={m['phone_match']} vol={m['volume_estimate']} ({m['volume_basis'][:100]})")
    print(f"  google: {m['google_summary'][:150]} | resv={m['reservable']} cocktails={m['serves_cocktails']} types={m['types_live'][:70]} price={m['price_level'][12:]}")
    if m['status_flags']: print(f"  FLAGS: {m['status_flags']}")
    print(f"  hours: {m['hours'][:60]}")
    if m['abc_hits']: print(f"  ABC: {m['abc_hits'][:420]}")
    if m['owner_site_sentences']: print(f"  site: {m['owner_site_sentences'][:300]}")
    if m['owner_search_hints']: print(f"  hints: {m['owner_search_hints'][:400]}")
    print(f"  search: {m['owner_search_top'][:350]}")
