import io
p = r"\\10.134.10.5\BKNinfo\24 Pharmacy\EXT\pharmacy_server\bkn_ks_server.py"
src = io.open(p, encoding="utf-8").read()
lines = src.split("\n")

def find(pred, start=0):
    for i in range(start, len(lines)):
        if pred(lines[i]):
            return i
    return -1

a_start = find(lambda l: l.startswith("# ── Jasper (aa-report) service login"))
a_end   = find(lambda l: l.startswith("# ── Home Medication Sheet (from ArcusAir"))
assert a_start != -1 and a_end != -1 and a_start < a_end, ("A", a_start, a_end)

b_start = find(lambda l: l.startswith("# ── Home Medication Sheet (from RT_COMMON_286_UNBILL report)"))
kpi_comment = find(lambda l: l.startswith("# ── KPI helpers"), b_start if b_start != -1 else 0)
assert b_start != -1 and kpi_comment != -1 and b_start < kpi_comment, ("B", b_start, kpi_comment)
b_end = kpi_comment

# delete higher range first
del lines[b_start:b_end]
del lines[a_start:a_end]

arc = find(lambda l: l.startswith("# ── Home Medication Sheet (from ArcusAir"))
assert arc != -1
norm_block = [
    "def _hm_norm(s):",
    "    return re.sub(r'\\s+', ' ', str(s or '').replace('\\u00a0', ' ')).strip()",
    "",
    "",
]
lines[arc:arc] = norm_block

io.open(p, "w", encoding="utf-8").write("\n".join(lines))
print("done. new line count:", len(lines))
