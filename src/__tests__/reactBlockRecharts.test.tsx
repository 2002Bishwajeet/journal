// @vitest-environment happy-dom
/**
 * Recharts in a react block (#427) is drawn in Journal's theme by default: the module that
 * vite.config.ts bundles into the frame's window.Recharts. Here it runs on the app's own
 * React and Recharts; the e2e spec e2e/editor/live-react.spec.ts runs the bundle in the frame.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Recharts from 'recharts';
import { LineChart, themeChildren, themeColour, type ChartTheme } from '@/lib/reactBlockRecharts';

// The light theme's values in src/index.css.
const THEME: ChartTheme = {
  series: ['#39362E', '#8A5344', '#718968', '#9D7F42', '#4F7A96'],
  background: '#FDFCF8',
  foreground: '#2C2B29',
  muted: '#F2F0E9',
  mutedForeground: '#8A8780',
  border: '#E6E4DD',
  radius: '0.5rem',
};

type Props = Record<string, unknown>;
/** The chart's children after theming, flattened through fragments, as elements. */
function themed(children: ReactNode): ReactElement<Props>[] {
  const out: ReactElement<Props>[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (isValidElement<Props>(node)) {
      if (node.type === Fragment) walk(node.props.children as ReactNode);
      else out.push(node);
    }
  };
  walk(themeChildren(children, THEME));
  return out;
}

describe('themeColour', () => {
  it('should turn the Recharts docs sample colours into the chart inks, in order, in any case', () => {
    expect(['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#413ea0'].map((colour) => themeColour(colour, THEME))).toEqual(THEME.series);
    expect(themeColour('#8884D8', THEME)).toBe(THEME.series[0]);
  });

  it('should leave any other colour as written', () => {
    for (const colour of ['#123456', 'red', 'var(--chart-3)', undefined, 3]) expect(themeColour(colour, THEME)).toBe(colour);
  });
});

describe('themeChildren', () => {
  it('should draw the series in --chart-1 … --chart-5 in order, through fragments and arrays', () => {
    const [a, b, c, d] = themed([
      <Recharts.Line key="a" dataKey="a" />,
      <Fragment key="f">
        <Recharts.Bar dataKey="b" />
        {[<Recharts.Area key="c" dataKey="c" />]}
      </Fragment>,
      <Recharts.Scatter key="d" dataKey="d" />,
    ]);
    expect(a.props.stroke).toBe(THEME.series[0]);
    expect(b.props.fill).toBe(THEME.series[1]);
    expect(c.props.stroke).toBe(THEME.series[2]);
    expect(c.props.fill).toBe(THEME.series[2]);
    expect(d.props.fill).toBe(THEME.series[3]);
  });

  it('should start again at --chart-1 after the fifth series', () => {
    const lines = themed(Array.from({ length: 6 }, (_, i) => <Recharts.Line key={i} dataKey={`k${i}`} />));
    expect(lines.map((line) => line.props.stroke)).toEqual([...THEME.series, THEME.series[0]]);
  });

  it('should keep a colour the block set, and turn a sample colour into its ink', () => {
    const [own, sample, next] = themed([
      <Recharts.Line key="1" dataKey="a" stroke="#123456" />,
      <Recharts.Line key="2" dataKey="b" stroke="#8884d8" />,
      <Recharts.Bar key="3" dataKey="c" fill="#82CA9D" />,
    ]);
    expect(own.props.stroke).toBe('#123456');
    expect(sample.props.stroke).toBe(THEME.series[0]);
    expect(next.props.fill).toBe(THEME.series[1]);
  });

  it('should put the dots of a line on the background, not white', () => {
    const [line] = themed(<Recharts.Line dataKey="a" />);
    expect(line.props.fill).toBe(THEME.background);
    expect(line.props.activeDot).toEqual({ stroke: THEME.background });
  });

  it('should draw the grid in --border, and the axes in --border with --muted-foreground labels', () => {
    const [grid, x, y] = themed([<Recharts.CartesianGrid key="g" />, <Recharts.XAxis key="x" dataKey="name" />, <Recharts.YAxis key="y" tick={{ fontSize: 14 }} />]);
    expect(grid.props.stroke).toBe(THEME.border);
    expect(x.props.stroke).toBe(THEME.border);
    expect(x.props.tick).toEqual({ fill: THEME.mutedForeground, fontSize: 12 });
    expect(y.props.tick).toEqual({ fill: THEME.mutedForeground, fontSize: 14 });
  });

  it("should leave an axis whose line colour the block set, so its labels keep following it", () => {
    const [x] = themed(<Recharts.XAxis dataKey="name" stroke="#999999" />);
    expect(x.props.stroke).toBe('#999999');
    expect(x.props.tick).toBeUndefined();
  });

  it('should draw the tooltip and legend text in the foreground on the background, under the block’s own styles', () => {
    const [tooltip, legend] = themed([<Recharts.Tooltip key="t" contentStyle={{ borderRadius: 2 }} />, <Recharts.Legend key="l" />]);
    expect(tooltip.props.contentStyle).toEqual({ backgroundColor: THEME.background, border: `1px solid ${THEME.border}`, borderRadius: 2, color: THEME.foreground });
    expect(tooltip.props.itemStyle).toEqual({ color: THEME.foreground });
    expect(tooltip.props.labelStyle).toEqual({ color: THEME.foreground });
    const label = (legend.props.formatter as (value: string) => ReactElement<{ style: Props; children: string }>)('Sales');
    expect(label.props.style).toEqual({ color: THEME.foreground });
    expect(label.props.children).toBe('Sales');
  });

  it('should give each sector of a pie the next ink, unless the block coloured it', () => {
    const data = [{ v: 1 }, { v: 2 }, { v: 3 }];
    const [pie] = themed(<Recharts.Pie data={data} dataKey="v" />);
    const cells = (pie.props.children as ReactElement<Props>[]).filter((child) => child.type === Recharts.Cell);
    expect(cells.map((cell) => cell.props.fill)).toEqual(THEME.series.slice(0, 3));
    expect(pie.props.stroke).toBe(THEME.background);

    const [own] = themed(
      <Recharts.Pie data={data} dataKey="v">
        <Recharts.Cell fill="#ff7300" />
        <Recharts.Cell fill="#123456" />
        <Recharts.Cell />
      </Recharts.Pie>,
    );
    expect((own.props.children as ReactElement<Props>[]).map((cell) => cell.props.fill)).toEqual([THEME.series[3], '#123456', THEME.series[2]]);

    const [byData] = themed(<Recharts.Pie data={[{ v: 1, fill: '#123456' }]} dataKey="v" />);
    expect(byData.props.children).toBeUndefined();
  });

  it('should leave anything that is not a Recharts part as it is', () => {
    const [custom] = themed(<text x={1}>Note</text>);
    expect(custom.type).toBe('text');
    expect(custom.props).toEqual({ x: 1, children: 'Note' });
  });
});

describe('LineChart, rendered', () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it("should draw two series with no colour props in --chart-1 and --chart-2, as the frame's variables hold them", async () => {
    THEME.series.forEach((colour, i) => document.documentElement.style.setProperty(`--chart-${i + 1}`, colour));
    for (const [name, value] of [['--border', THEME.border], ['--muted-foreground', THEME.mutedForeground], ['--background', THEME.background]]) {
      document.documentElement.style.setProperty(name, value);
    }
    const data = [
      { name: 'Mon', a: 1, b: 3 },
      { name: 'Tue', a: 2, b: 1 },
    ];
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () =>
      root.render(
        <LineChart width={400} height={200} data={data}>
          <Recharts.CartesianGrid />
          <Recharts.XAxis dataKey="name" />
          <Recharts.Line dataKey="a" isAnimationActive={false} />
          <Recharts.Line dataKey="b" isAnimationActive={false} />
        </LineChart>,
      ),
    );
    const curves = [...document.querySelectorAll('.recharts-line-curve')].map((curve) => curve.getAttribute('stroke'));
    expect(curves).toEqual([THEME.series[0], THEME.series[1]]);
    await act(async () => root.unmount());
  });
});
