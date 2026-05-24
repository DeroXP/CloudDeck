// Universal focus manager.
//
// Every interactive element registers itself in a group. The manager tracks
// which group is "active" and which element within it has focus. Inputs
// (keyboard arrows, controller D-pad, mobile swipes) all funnel through
// `moveFocus(direction)` which picks the nearest neighbor in 2D space.
//
// This lets the same XMB be controlled by mouse, keyboard, gamepad, and
// touch swipes without each module growing its own input handling.

export class FocusManager {
  constructor() {
    this.groups = new Map();   // groupId -> { elements: Set<HTMLElement>, currentEl }
    this.activeGroup = null;
    this.lastInputMode = 'mouse';
  }

  registerGroup(groupId) {
    if (!this.groups.has(groupId)) {
      this.groups.set(groupId, { elements: new Set(), currentEl: null });
    }
  }

  register(groupId, element) {
    this.registerGroup(groupId);
    const group = this.groups.get(groupId);
    group.elements.add(element);
    element.dataset.cdFocusGroup = groupId;
    element.addEventListener('mouseenter', () => {
      if (this.lastInputMode !== 'mouse') return;
      this.setFocus(groupId, element);
    });
    element.addEventListener('focus', () => this.setFocus(groupId, element));
  }

  unregisterGroup(groupId) {
    const group = this.groups.get(groupId);
    if (group?.currentEl) group.currentEl.classList.remove('cd-focused');
    this.groups.delete(groupId);
    if (this.activeGroup === groupId) this.activeGroup = null;
  }

  setActiveGroup(groupId) {
    this.activeGroup = groupId;
    const group = this.groups.get(groupId);
    if (!group) return;
    if (!group.currentEl && group.elements.size > 0) {
      this.setFocus(groupId, [...group.elements][0]);
    }
  }

  setFocus(groupId, element) {
    const group = this.groups.get(groupId);
    if (!group || !group.elements.has(element)) return;
    if (group.currentEl) group.currentEl.classList.remove('cd-focused');
    group.currentEl = element;
    element.classList.add('cd-focused');
    this.activeGroup = groupId;
    // Scroll into view smoothly
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  current() {
    const group = this.groups.get(this.activeGroup);
    return group?.currentEl || null;
  }

  activate() {
    const el = this.current();
    if (!el) return;
    el.click();
  }

  moveFocus(direction) {
    const group = this.groups.get(this.activeGroup);
    if (!group) return false;
    if (!group.currentEl) {
      const first = [...group.elements][0];
      if (first) this.setFocus(this.activeGroup, first);
      return true;
    }
    const fromRect = group.currentEl.getBoundingClientRect();
    const from = { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 };
    let best = null, bestScore = Infinity;
    for (const el of group.elements) {
      if (el === group.currentEl) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = to.x - from.x, dy = to.y - from.y;

      let primary, secondary;
      switch (direction) {
        case 'left':  primary = -dx; secondary = Math.abs(dy); break;
        case 'right': primary = dx;  secondary = Math.abs(dy); break;
        case 'up':    primary = -dy; secondary = Math.abs(dx); break;
        case 'down':  primary = dy;  secondary = Math.abs(dx); break;
      }
      if (primary <= 0) continue;
      const score = primary + secondary * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) {
      this.setFocus(this.activeGroup, best);
      return true;
    }
    return false;
  }

  setInputMode(mode) {
    if (mode === this.lastInputMode) return;
    this.lastInputMode = mode;
    document.body.classList.remove('cd-input-mouse', 'cd-input-controller', 'cd-input-touch');
    document.body.classList.add(`cd-input-${mode}`);
  }
}

export const focus = new FocusManager();
