---
title: Team offsite budget
tags: [work, planning]
created: 2026-11-01T11:00:00Z
modified: 2026-11-07T15:00:00Z
---
```html id=offsite1
<div style="font-family: inherit; display: grid; gap: 12px">
  <label>People <input id="p" type="range" min="4" max="20" value="9"></label>
  <label>Nights <input id="n" type="range" min="1" max="4" value="2"></label>
  <div id="out" style="font-size: 28px; font-weight: 600"></div>
</div>
<script>
  const f = () => { const p = +document.getElementById('p').value, n = +document.getElementById('n').value;
    document.getElementById('out').textContent = p + ' people · ' + n + ' nights · €' + (p * n * 140 + p * 60).toLocaleString(); };
  document.querySelectorAll('input').forEach((i) => i.oninput = f); f();
</script>
```
