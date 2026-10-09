// @vitest-environment happy-dom
/**
 * `journal-ui` (#558), the UI kit a react block can import: the module vite.config.ts bundles
 * into the frame's window.JournalUI. Here it runs on the app's own React; the e2e spec
 * e2e/editor/live-react-libraries.spec.ts runs the bundle in the frame, in light and dark.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  Select,
  SelectItem,
  Slider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/lib/reactBlockUi';
import { TAILWIND_UTILITIES } from '@/lib/reactBlockTailwind';

let root: Root | null = null;
let host: HTMLDivElement;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
});

async function render(node: ReactNode): Promise<HTMLDivElement> {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

/** Sets a form control's value the way typing or dragging does, so React sees the change. */
async function change(el: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

const click = (el: Element) => act(async () => (el as HTMLElement).click());

describe('journal-ui', () => {
  it('should use only classes the frame’s Tailwind sheet has, in every variant and state', async () => {
    const page = await render(
      <div>
        {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
        {(['sm', 'lg', 'icon'] as const).map((size) => (
          <Button key={size} size={size}>
            {size}
          </Button>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
          </CardHeader>
          <CardContent>Content</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Panel A</TabsContent>
        </Tabs>
        <Input />
        <Select placeholder="Pick">
          <SelectItem value="x">X</SelectItem>
        </Select>
        <Slider defaultValue={[20]} />
        <Switch />
        <Switch defaultChecked />
        {(['default', 'secondary', 'destructive', 'outline'] as const).map((variant) => (
          <Badge key={variant} variant={variant}>
            {variant}
          </Badge>
        ))}
        <Progress value={40} />
      </div>,
    );
    const classes = new Set([...page.querySelectorAll('[class]')].flatMap((el) => [...el.classList]));
    expect(classes.size).toBeGreaterThan(40);
    const sheet = new Set(TAILWIND_UTILITIES);
    expect([...classes].filter((name) => !sheet.has(name))).toEqual([]);
  });

  it('should let a later class replace an earlier one of the same kind, as shadcn/ui’s cn does', async () => {
    const page = await render(<Button className="h-12">Tall</Button>);
    expect(page.querySelector('button')!.classList.contains('h-9')).toBe(false);
    expect(page.querySelector('button')!.classList.contains('h-12')).toBe(true);
  });

  it('should give Button a type of button, so it never submits a form, and pass its props on', async () => {
    const page = await render(
      <Button variant="outline" disabled aria-label="Save">
        Save
      </Button>,
    );
    const button = page.querySelector('button')!;
    expect(button.getAttribute('type')).toBe('button');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Save');
    expect(button.classList.contains('border')).toBe(true);
  });

  it('should show the content of the selected tab, and report a change', async () => {
    const changes: string[] = [];
    const page = await render(
      <Tabs defaultValue="week" onValueChange={(value) => changes.push(value)}>
        <TabsList>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>
        <TabsContent value="week">Seven days</TabsContent>
        <TabsContent value="month">Thirty days</TabsContent>
      </Tabs>,
    );
    const tabs = [...page.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(page.querySelector('[role="tabpanel"]')!.textContent).toBe('Seven days');
    await click(tabs[1]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(page.querySelector('[role="tabpanel"]')!.textContent).toBe('Thirty days');
    expect(changes).toEqual(['month']);
  });

  it('should keep a controlled Tabs on the value it is given', async () => {
    const page = await render(
      <Tabs value="a">
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>,
    );
    await click(page.querySelectorAll('[role="tab"]')[1]);
    expect(page.querySelector('[role="tabpanel"]')!.textContent).toBe('Panel A');
  });

  it('should toggle a Switch on click, as a switch for assistive technology', async () => {
    const changes: boolean[] = [];
    const page = await render(<Switch aria-label="Daily" onCheckedChange={(checked) => changes.push(checked)} />);
    const toggle = page.querySelector('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.classList.contains('bg-primary')).toBe(true);
    await click(toggle);
    expect(changes).toEqual([true, false]);
  });

  it('should take and report a Slider’s value as an array of one, as shadcn/ui does', async () => {
    function Goal() {
      const [goal, setGoal] = useState([500]);
      return (
        <div>
          <Slider value={goal} onValueChange={setGoal} max={2000} step={50} />
          <p>{goal[0]}</p>
        </div>
      );
    }
    const page = await render(<Goal />);
    const slider = page.querySelector('input')!;
    expect(slider.type).toBe('range');
    expect(slider.max).toBe('2000');
    expect(slider.value).toBe('500');
    await change(slider, '750');
    expect(page.querySelector('p')!.textContent).toBe('750');
  });

  it('should show a Select’s placeholder until an item is chosen, and report the choice', async () => {
    const changes: string[] = [];
    const page = await render(
      <Select placeholder="Pick a mood" onValueChange={(value) => changes.push(value)}>
        <SelectItem value="calm">Calm</SelectItem>
        <SelectItem value="busy">Busy</SelectItem>
      </Select>,
    );
    const select = page.querySelector('select')!;
    expect(select.selectedOptions[0].textContent).toBe('Pick a mood');
    await change(select, 'busy');
    expect(select.value).toBe('busy');
    expect(changes).toEqual(['busy']);
  });

  it('should fill a Progress bar to its value, kept between 0 and 100', async () => {
    const page = await render(
      <div>
        <Progress value={40} />
        <Progress value={140} />
      </div>,
    );
    const bars = [...page.querySelectorAll('[role="progressbar"]')];
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['40', '100']);
    expect(bars.map((bar) => (bar.firstElementChild as HTMLElement).style.width)).toEqual(['40%', '100%']);
  });
});
