/**
 * Recharts for a `react` live block (#427), drawn in Journal's theme by default. vite.config.ts
 * bundles this module, with Recharts, into the script that sets window.Recharts in the frame;
 * the app itself never imports it.
 *
 * It is Recharts itself, except that each chart passes its children through themeChildren:
 * series take `--chart-2` … `--chart-5` in order (`--chart-1` is nearly the text colour), the grid and axes `--border` and
 * `--muted-foreground`, the tooltip and legend the theme's text and background. A colour the
 * block sets wins, except the sample colours of the Recharts docs, which agents copy: those
 * become the chart inks.
 */
import { Children, cloneElement, createElement, Fragment, isValidElement, type FunctionComponent, type ReactElement, type ReactNode } from 'react';
import * as Recharts from 'recharts';

export * from 'recharts';

/** The theme values a chart is drawn in, as the frame's variables hold them. */
export interface ChartTheme {
  /** `--chart-2` … `--chart-5`. */
  series: string[];
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  radius: string;
}

/** The colours of the Recharts docs' examples, in the order they become the series inks: `--chart-2` … `--chart-5`, then `--chart-2`. */
const SAMPLE_COLOURS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#413ea0'];

/** A colour the block set: a Recharts sample colour becomes its chart ink; any other stays as written. */
export function themeColour(colour: unknown, theme: ChartTheme): unknown {
  const sample = typeof colour === 'string' ? SAMPLE_COLOURS.indexOf(colour.trim().toLowerCase()) : -1;
  return sample === -1 ? colour : theme.series[sample % theme.series.length];
}

type Props = Record<string, unknown>;
type Element = ReactElement<Props>;

const isPlainObject = (value: unknown): value is Props => typeof value === 'object' && value !== null && !isValidElement(value);
/** `value` with `defaults` under it, when it is unset or an object of props; anything else (a function, an element, false) as it is. */
const under = (defaults: Props, value: unknown) => (value === undefined || value === true ? defaults : isPlainObject(value) ? { ...defaults, ...value } : value);

const SERIES = new Set<unknown>([Recharts.Line, Recharts.Area, Recharts.Bar, Recharts.Scatter, Recharts.Radar]);
const AXES = new Set<unknown>([Recharts.XAxis, Recharts.YAxis, Recharts.PolarAngleAxis, Recharts.PolarRadiusAxis]);

/** The props of a series that draws in `colour`: its line, its fill, or both. */
function seriesProps(element: Element, colour: string, theme: ChartTheme): Props {
  const { props } = element;
  const paint = (name: string) => (props[name] === undefined ? colour : themeColour(props[name], theme));
  if (element.type === Recharts.Line) {
    // The dots inside the line are on the background, not white.
    return { stroke: paint('stroke'), fill: props.fill ?? theme.background, activeDot: under({ stroke: theme.background }, props.activeDot) };
  }
  if (element.type === Recharts.Bar || element.type === Recharts.Scatter) {
    return { fill: paint('fill'), ...(element.type === Recharts.Bar && props.background === true ? { background: { fill: theme.muted } } : {}) };
  }
  // Area and Radar: an outline and a fill of the same colour.
  return { stroke: paint('stroke'), fill: paint('fill') };
}

/** A Cell's sample colour as its ink, and in a Pie, an unset fill as the next ink. */
function cells(children: ReactNode, theme: ChartTheme, fillUnset: boolean): ReactNode {
  let index = 0;
  return Children.map(children, (child) => {
    if (!isValidElement<Props>(child) || child.type !== Recharts.Cell) return child;
    const colour = theme.series[index++ % theme.series.length];
    const fill = child.props.fill === undefined ? (fillUnset ? colour : undefined) : themeColour(child.props.fill, theme);
    return fill === child.props.fill ? child : cloneElement(child, { fill });
  });
}

/** A Pie's sectors in the inks, one each, unless the block coloured them (with a fill, its cells or its data). */
function pieProps(element: Element, theme: ChartTheme): Props {
  const { props } = element;
  const stroke = props.stroke ?? theme.background;
  const data = Array.isArray(props.data) ? props.data : [];
  if (props.fill !== undefined || data.some((entry) => isPlainObject(entry) && 'fill' in entry)) {
    return { stroke, ...(props.fill === undefined ? {} : { fill: themeColour(props.fill, theme) }), children: cells(props.children as ReactNode, theme, false) };
  }
  const children = Children.toArray(props.children as ReactNode);
  if (children.some((child) => isValidElement(child) && child.type === Recharts.Cell)) return { stroke, children: cells(children, theme, true) };
  return { stroke, children: [...children, ...data.map((_, i) => createElement(Recharts.Cell, { key: `journal-cell-${i}`, fill: theme.series[i % theme.series.length] }))] };
}

/** The props that draw one child of a chart in the theme, or null to leave it as it is. */
function childProps(element: Element, theme: ChartTheme, nextSeries: () => string): Props | null {
  const { type, props } = element;
  if (SERIES.has(type)) return { ...seriesProps(element, nextSeries(), theme), children: cells(props.children as ReactNode, theme, false) };
  if (type === Recharts.Pie) return pieProps(element, theme);
  if (type === Recharts.CartesianGrid || type === Recharts.PolarGrid) return { stroke: props.stroke ?? theme.border };
  if (AXES.has(type)) {
    // An axis draws its tick labels in its line colour. With the theme's line, the labels take
    // the secondary text colour, at the app's caption size; with a line colour of the block's,
    // they keep following it.
    return props.stroke === undefined ? { stroke: theme.border, tick: under({ fill: theme.mutedForeground, fontSize: 12 }, props.tick) } : null;
  }
  if (type === Recharts.Tooltip) {
    const text = { color: theme.foreground };
    return {
      contentStyle: { backgroundColor: theme.background, border: `1px solid ${theme.border}`, borderRadius: theme.radius, ...text, ...(props.contentStyle as Props) },
      labelStyle: { ...text, ...(props.labelStyle as Props) },
      itemStyle: { ...text, ...(props.itemStyle as Props) },
      cursor: under({ stroke: theme.border, fill: theme.muted }, props.cursor),
    };
  }
  if (type === Recharts.Legend) {
    return {
      inactiveColor: props.inactiveColor ?? theme.mutedForeground,
      formatter: props.formatter ?? ((value: ReactNode) => createElement('span', { style: { color: theme.foreground } }, value)),
    };
  }
  return null;
}

/**
 * A chart's children drawn in the theme: each series takes the next chart ink, in order,
 * through fragments and arrays. A child that is none of Recharts' own is left as it is.
 */
export function themeChildren(children: ReactNode, theme: ChartTheme): ReactNode {
  let series = 0;
  const nextSeries = () => theme.series[series++ % theme.series.length];
  const visit = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (child) => {
      if (!isValidElement<Props>(child)) return child;
      if (child.type === Fragment) return createElement(Fragment, null, visit(child.props.children as ReactNode));
      const props = childProps(child, theme, nextSeries);
      return props ? cloneElement(child, props) : child;
    });
  return visit(children);
}

/** The theme as the frame's `:root` variables hold it now (buildSrcdoc sets them). */
function frameTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: [2, 3, 4, 5].map((n) => token(`--chart-${n}`)),
    background: token('--background'),
    foreground: token('--foreground'),
    muted: token('--muted'),
    mutedForeground: token('--muted-foreground'),
    border: token('--border'),
    radius: token('--radius'),
  };
}

// Colours are resolved in the frame rather than written as var(--chart-2): an SVG presentation
// attribute does not take var() in every browser.
function themed<Chart extends (props: never) => ReactNode>(chart: Chart, name: string, margin?: Props): Chart {
  const Inner = chart as unknown as FunctionComponent<{ children?: ReactNode; margin?: Props }>;
  const Themed = (props: { children?: ReactNode; margin?: Props }) =>
    createElement(Inner, { ...props, margin: props.margin ?? margin, children: themeChildren(props.children, frameTheme()) });
  Themed.displayName = name;
  // The same props as the chart it wraps.
  return Themed as unknown as Chart;
}

// Recharts' own margin, wider on the right: its 5px clips the last x-axis label.
const CARTESIAN_MARGIN = { top: 5, right: 20, bottom: 5, left: 5 };

export const LineChart = themed(Recharts.LineChart, 'LineChart', CARTESIAN_MARGIN);
export const BarChart = themed(Recharts.BarChart, 'BarChart', CARTESIAN_MARGIN);
export const AreaChart = themed(Recharts.AreaChart, 'AreaChart', CARTESIAN_MARGIN);
export const ComposedChart = themed(Recharts.ComposedChart, 'ComposedChart', CARTESIAN_MARGIN);
export const ScatterChart = themed(Recharts.ScatterChart, 'ScatterChart', CARTESIAN_MARGIN);
export const PieChart = themed(Recharts.PieChart, 'PieChart');
export const RadarChart = themed(Recharts.RadarChart, 'RadarChart');
export const RadialBarChart = themed(Recharts.RadialBarChart, 'RadialBarChart');
