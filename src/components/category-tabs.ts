class CategoryTabs extends HTMLElement {
  private observer?: ResizeObserver;
  private listeners?: AbortController;

  connectedCallback() {
    const row = this.querySelector<HTMLElement>('.tabs');
    const dropdown = this.querySelector<HTMLDetailsElement>('.more-tabs');
    const toggle = dropdown?.querySelector('summary');
    if (!row || !dropdown || !toggle) return;
    this.listeners = new AbortController();
    const { signal } = this.listeners;
    document.addEventListener('click', event => {
      if (dropdown.open && !event.composedPath().includes(dropdown)) dropdown.open = false;
    }, { signal });
    dropdown.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !dropdown.open) return;
      event.preventDefault();
      dropdown.open = false;
      toggle.focus();
    }, { signal });

    const tabs = Array.from(row.querySelectorAll<HTMLAnchorElement>(':scope > a'));
    const menuLinks = Array.from(dropdown.querySelectorAll('a'));
    const active = tabs.findIndex(tab => tab.hasAttribute('aria-current'));
    let previousWidth = 0;

    const fit = () => {
      const available = row.getBoundingClientRect().width;
      if (available === 0) return;
      previousWidth = available;
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;

      // Measure each tab at its natural width, then reserve space for Más only if needed.
      tabs.forEach(tab => { tab.hidden = false; });
      dropdown.hidden = false;
      const widths = tabs.map(tab => tab.getBoundingClientRect().width);
      const fullWidth = widths.reduce((total, width) => total + width, 0) + gap * (tabs.length - 1);
      let visible = tabs.length;
      if (fullWidth > available) {
        let used = toggle.getBoundingClientRect().width;
        visible = 0;
        for (const width of widths) {
          if (used + gap + width > available) break;
          used += gap + width;
          visible++;
        }
      }

      tabs.forEach((tab, index) => { tab.hidden = index >= visible; });
      menuLinks.forEach((link, index) => { link.hidden = index < visible; });
      dropdown.hidden = visible === tabs.length;
      if (dropdown.hidden) dropdown.open = false;
      toggle.classList.toggle('selected', active >= visible);
    };

    fit();
    this.observer = new ResizeObserver(() => {
      if (row.getBoundingClientRect().width !== previousWidth) fit();
    });
    this.observer.observe(row);
    document.fonts.ready.then(() => { if (this.isConnected) fit(); });
  }

  disconnectedCallback() {
    this.listeners?.abort();
    this.observer?.disconnect();
  }
}

customElements.define('category-tabs', CategoryTabs);
