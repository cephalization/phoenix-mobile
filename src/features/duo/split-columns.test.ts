import { describe, expect, it } from 'vitest';

import { applyColumnRules, columnRoleOf, nativePopAction, reconcileScreens } from './split-columns';

const route = (key: string, name: string) => ({ key, name });

const home = route('home', 'index');
const instance = route('instance', 'instances/[id]/index');
const project = route('project', 'instances/[id]/projects/[projectId]');
const sessions = route('sessions', 'instances/[id]/projects/[projectId]/sessions/index');
const traceA = route('trace-a', 'instances/[id]/projects/[projectId]/traces/[traceId]');
const traceB = route('trace-b', 'instances/[id]/projects/[projectId]/traces/[traceId]');
const session = route('session', 'instances/[id]/projects/[projectId]/sessions/[sessionId]');

const stack = (...routes: { key: string; name: string }[]) => ({
  key: 'root',
  index: routes.length - 1,
  routes,
});

describe('columnRoleOf', () => {
  it('puts list pages in the sidebar and everything they open in the detail column', () => {
    expect([home, instance, project, sessions].map((r) => columnRoleOf(r.name))).toEqual([
      'sidebar',
      'sidebar',
      'sidebar',
      'sidebar',
    ]);
    expect(columnRoleOf(traceA.name)).toBe('detail');
    expect(columnRoleOf(session.name)).toBe('detail');
  });
});

describe('applyColumnRules', () => {
  it('replaces the detail column when a list selects another page', () => {
    const previous = stack(home, instance, project, traceA);
    const next = applyColumnRules(previous, stack(home, instance, project, traceA, traceB), true);

    expect(next.routes.map((r) => r.key)).toEqual(['home', 'instance', 'project', 'trace-b']);
    expect(next.index).toBe(3);
  });

  it('stacks a page drilled into from the detail column', () => {
    const previous = stack(home, project, sessions, session);
    const pushed = stack(home, project, sessions, session, traceA);

    expect(applyColumnRules(previous, pushed, false)).toBe(pushed);
  });

  it('clears the detail column when the sidebar opens another list', () => {
    const previous = stack(home, instance, project, traceA);

    const next = applyColumnRules(
      previous,
      stack(home, instance, project, traceA, sessions),
      false,
    );

    expect(next.routes.map((r) => r.key)).toEqual(['home', 'instance', 'project', 'sessions']);
  });

  it('leaves pops and updates to existing routes alone', () => {
    const previous = stack(home, project, traceA);
    const popped = stack(home, project);

    expect(applyColumnRules(previous, popped, true)).toBe(popped);
  });
});

describe('nativePopAction', () => {
  it('pops the dismissed route and everything above it', () => {
    expect(nativePopAction(stack(home, project, sessions, session), 'sessions')).toEqual({
      type: 'POP',
      payload: { count: 2 },
      source: 'session',
      target: 'root',
    });
  });

  it('ignores a dismissal JavaScript already removed, and the root', () => {
    expect(nativePopAction(stack(home, project), 'session')).toBeNull();
    expect(nativePopAction(stack(home, project), 'home')).toBeNull();
  });
});

describe('reconcileScreens', () => {
  it('keeps an outgoing screen in place until UIKit reports it gone', () => {
    const before = [home, project, traceA];

    expect(reconcileScreens(before, [home, project], new Set()).map((r) => r.key)).toEqual([
      'home',
      'project',
      'trace-a',
    ]);
    expect(reconcileScreens(before, [home, project], new Set(['trace-a']))).toEqual([
      home,
      project,
    ]);
  });
});
