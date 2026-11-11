---
title: Half marathon block
tags: [running, health]
created: 2026-10-20T06:30:00Z
modified: 2026-11-11T07:05:00Z
---
Week 6 of 10. Long run went well, legs felt fresh on the last 5 km.

```react id=runlog6
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from 'journal-ui';

const weeks = [
  { w: 'W1', km: 18 }, { w: 'W2', km: 22 }, { w: 'W3', km: 26 },
  { w: 'W4', km: 21 }, { w: 'W5', km: 30 }, { w: 'W6', km: 34 },
];

export default function App() {
  const total = weeks.reduce((s, x) => s + x.km, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly distance</CardTitle>
        <CardDescription>{total} km so far · goal 21.1 km on Dec 7</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks}>
              <XAxis dataKey="w" />
              <YAxis width={28} />
              <Tooltip />
              <Bar dataKey="km" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-2">
          <Badge>+13% vs last week</Badge>
          <Badge variant="secondary">Pace 5:12 /km</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
```

## This week

- [x] Tue: 8 km easy
- [x] Thu: 6 × 800 m intervals
- [ ] Sun: 18 km long run
