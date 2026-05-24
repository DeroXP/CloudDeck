// XMB renderer — categories + items panel. Other modules (library,
// dashboard, etc.) register themselves and render into the items pane when
// their category becomes active.

import { focus } from './focus.js';
import { input } from './input.js';

const CATEGORIES = ['games', 'dashboard', 'screenshots', 'settings'];

export class XMB extends EventTarget {
  constructor() {
    super();
    this.renderers = new Map();   // category -> async (root) => void
    this.activeIndex = 0;
    this.items = document.getElementById('items');
    this.cats = document.getElementById('cats');
    this.catEls = [...this.cats.querySelectorAll('.cd-cat')];

    this.catEls.forEach((el, idx) => {
      focus.register('xmb-cats', el);
      el.addEventListener('click', () => this.setActive(idx));
    });

    focus.setActiveGroup('xmb-cats');
    this.setActive(0, { silent: true });

    input.addEventListener('shoulder', e => {
      const dir = e.detail.side === 'left' ? -1 : 1;
      this.setActive((this.activeIndex + dir + CATEGORIES.length) % CATEGORIES.length);
    });
    input.addEventListener('jump-cat', e => {
      const idx = Math.max(0, Math.min(CATEGORIES.length - 1, e.detail.index));
      this.setActive(idx);
    });

    input.addEventListener('nav', e => this._handleNav(e.detail.direction));
    input.addEventListener('confirm', () => focus.activate());

    this.activeCategoryName = CATEGORIES[0];
  }

  registerCategory(name, renderer) {
    this.renderers.set(name, renderer);
    if (this.activeCategoryName === name) this._renderItems(name);
  }

  setActive(index, { silent = false } = {}) {
    this.activeIndex = index;
    this.catEls.forEach((el, i) => {
      el.classList.toggle('cd-cat-active', i === index);
    });
    // Translate categories so the active one centers (subtle visual)
    const offset = -index * 160 + 200;
    this.cats.style.transform = `translateX(${offset}px)`;
    this.activeCategoryName = CATEGORIES[index];
    if (!silent) focus.setActiveGroup('xmb-cats');
    this._renderItems(this.activeCategoryName);
    this.dispatchEvent(new CustomEvent('change', { detail: { category: this.activeCategoryName } }));
  }

  _handleNav(direction) {
    if (focus.activeGroup === 'xmb-cats') {
      if (direction === 'left' && this.activeIndex > 0) {
        this.setActive(this.activeIndex - 1);
      } else if (direction === 'right' && this.activeIndex < CATEGORIES.length - 1) {
        this.setActive(this.activeIndex + 1);
      } else if (direction === 'down') {
        // Move focus into items panel if it has registered elements
        const groupId = `items-${this.activeCategoryName}`;
        if (focus.groups.has(groupId)) {
          focus.setActiveGroup(groupId);
        }
      } else if (direction === 'up') {
        // Move focus into shortcuts row above categories
        if (focus.groups.has('shortcuts')) focus.setActiveGroup('shortcuts');
      }
    } else if (focus.activeGroup === 'shortcuts') {
      if (direction === 'down') focus.setActiveGroup('xmb-cats');
      else focus.moveFocus(direction);
    } else if (focus.activeGroup?.startsWith('items-')) {
      const moved = focus.moveFocus(direction);
      if (!moved && direction === 'up') focus.setActiveGroup('xmb-cats');
    } else {
      focus.moveFocus(direction);
    }
  }

  async _renderItems(category) {
    this.items.classList.add('cd-items-fade');
    await new Promise(r => setTimeout(r, 180));
    this.items.innerHTML = '';
    const renderer = this.renderers.get(category);
    if (renderer) {
      try { await renderer(this.items); }
      catch (err) {
        console.error('[xmb] renderer failed:', err);
        this.items.innerHTML = `<div style="color:var(--cd-red); padding: 40px;">${err.message}</div>`;
      }
    } else {
      this.items.innerHTML = '<div style="text-align:center; color: var(--cd-fg-dim); padding: 60px;">Coming soon</div>';
    }
    this.items.classList.remove('cd-items-fade');
  }
}
