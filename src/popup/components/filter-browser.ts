/**
 * Filter Browser Component
 *
 * A modal dialog for browsing and selecting filters to add.
 * Shows filters organized by category with search.
 */

import type { FilterInfoMessage } from '../../lib/messages/types';
import type { FilterCategory } from '../../filters/registry';
import { CATEGORY_LABELS } from '../../lib/messages/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Callback when a filter is selected.
 */
export type FilterSelectCallback = (filterTypeId: string) => void;

/**
 * Options for the filter browser.
 */
export interface FilterBrowserOptions {
  /** Callback when a filter is selected */
  onSelect: FilterSelectCallback;

  /** Callback when the browser is closed */
  onClose: () => void;
}

// =============================================================================
// Filter Browser
// =============================================================================

/**
 * Filter browser modal.
 */
export class FilterBrowser {
  private container: HTMLElement;
  private filters: FilterInfoMessage[] = [];
  private searchInput: HTMLInputElement | null = null;
  private categoryButtons: HTMLElement | null = null;
  private filterList: HTMLElement | null = null;
  private selectedCategory: FilterCategory | 'all' = 'all';

  constructor(private options: FilterBrowserOptions) {
    this.container = this.createContainer();
  }

  /**
   * Show the browser with the given filters.
   */
  show(filters: FilterInfoMessage[]): void {
    this.filters = filters;
    this.selectedCategory = 'all';
    this.renderFilters();

    document.body.appendChild(this.container);
    this.container.classList.add('visible');

    // Focus search input
    setTimeout(() => {
      this.searchInput?.focus();
    }, 100);

    // Handle escape key
    document.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Hide the browser.
   */
  hide(): void {
    this.container.classList.remove('visible');
    document.removeEventListener('keydown', this.handleKeyDown);

    // Remove after animation
    setTimeout(() => {
      this.container.remove();
    }, 200);

    this.options.onClose();
  }

  /**
   * Create the browser container.
   */
  private createContainer(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'filter-browser-overlay';

    const modal = document.createElement('div');
    modal.className = 'filter-browser-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'filter-browser-header';
    header.innerHTML = `
      <h2>Add Filter</h2>
      <button class="filter-browser-close" title="Close">&times;</button>
    `;

    header.querySelector('.filter-browser-close')?.addEventListener('click', () => {
      this.hide();
    });

    // Search
    const searchContainer = document.createElement('div');
    searchContainer.className = 'filter-browser-search';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = 'Search filters...';
    this.searchInput.className = 'filter-browser-search-input';
    this.searchInput.addEventListener('input', () => {
      this.renderFilters();
    });

    searchContainer.appendChild(this.searchInput);

    // Category tabs
    this.categoryButtons = document.createElement('div');
    this.categoryButtons.className = 'filter-browser-categories';
    this.renderCategories();

    // Filter list
    this.filterList = document.createElement('div');
    this.filterList.className = 'filter-browser-list';

    // Assemble
    modal.appendChild(header);
    modal.appendChild(searchContainer);
    modal.appendChild(this.categoryButtons);
    modal.appendChild(this.filterList);

    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.hide();
      }
    });

    return overlay;
  }

  /**
   * Render category buttons.
   */
  private renderCategories(): void {
    if (!this.categoryButtons) return;

    const categories: Array<FilterCategory | 'all'> = [
      'all',
      'pitch',
      'eq',
      'dynamics',
      'time',
      'modulation',
      'utility',
    ];

    this.categoryButtons.innerHTML = '';

    for (const cat of categories) {
      const button = document.createElement('button');
      button.className = `category-btn ${this.selectedCategory === cat ? 'active' : ''}`;
      button.textContent = cat === 'all' ? 'All' : CATEGORY_LABELS[cat];
      button.addEventListener('click', () => {
        this.selectedCategory = cat;
        this.renderCategories();
        this.renderFilters();
      });
      this.categoryButtons.appendChild(button);
    }
  }

  /**
   * Render the filter list based on current search/category.
   */
  private renderFilters(): void {
    if (!this.filterList) return;

    const searchTerm = this.searchInput?.value.toLowerCase() || '';

    // Filter by category and search
    let filtered = this.filters;

    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(f => f.category === this.selectedCategory);
    }

    if (searchTerm) {
      filtered = filtered.filter(f =>
        f.displayName.toLowerCase().includes(searchTerm) ||
        f.description.toLowerCase().includes(searchTerm) ||
        f.tags.some(t => t.toLowerCase().includes(searchTerm))
      );
    }

    // Group by category for display
    const grouped = this.groupByCategory(filtered);

    this.filterList.innerHTML = '';

    if (filtered.length === 0) {
      this.filterList.innerHTML = `
        <div class="filter-browser-empty">
          <p>No filters found</p>
          ${searchTerm ? '<p class="hint">Try a different search term</p>' : ''}
        </div>
      `;
      return;
    }

    // Render each category group
    for (const [category, filters] of grouped) {
      // Only show category header if showing all categories
      if (this.selectedCategory === 'all' && grouped.size > 1) {
        const catHeader = document.createElement('div');
        catHeader.className = 'filter-browser-category-header';
        catHeader.textContent = CATEGORY_LABELS[category];
        this.filterList.appendChild(catHeader);
      }

      for (const filter of filters) {
        const card = this.createFilterCard(filter);
        this.filterList.appendChild(card);
      }
    }
  }

  /**
   * Create a card for a single filter.
   */
  private createFilterCard(filter: FilterInfoMessage): HTMLElement {
    const card = document.createElement('div');
    card.className = 'filter-browser-card';

    // CPU usage indicator
    const cpuClass = {
      low: 'cpu-low',
      medium: 'cpu-medium',
      high: 'cpu-high',
    }[filter.cpuUsage];

    card.innerHTML = `
      <div class="filter-card-header">
        <span class="filter-card-name">${filter.displayName}</span>
        <span class="filter-card-cpu ${cpuClass}" title="CPU: ${filter.cpuUsage}"></span>
        ${filter.requiresWasm ? '<span class="filter-card-wasm" title="Requires WASM">WASM</span>' : ''}
      </div>
      <p class="filter-card-desc">${filter.description}</p>
      <div class="filter-card-tags">
        ${filter.tags.map(t => `<span class="filter-tag">${t}</span>`).join('')}
      </div>
    `;

    // Add on click
    card.addEventListener('click', () => {
      this.options.onSelect(filter.id);
      this.hide();
    });

    return card;
  }

  /**
   * Group filters by category.
   */
  private groupByCategory(
    filters: FilterInfoMessage[]
  ): Map<FilterCategory, FilterInfoMessage[]> {
    const grouped = new Map<FilterCategory, FilterInfoMessage[]>();

    // Define order
    const order: FilterCategory[] = [
      'pitch',
      'eq',
      'dynamics',
      'time',
      'modulation',
      'utility',
      'ffmpeg',
    ];

    for (const cat of order) {
      const inCat = filters.filter(f => f.category === cat);
      if (inCat.length > 0) {
        grouped.set(cat, inCat);
      }
    }

    return grouped;
  }

  /**
   * Handle keyboard events.
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.hide();
    }
  };
}

/**
 * Create and show a filter browser.
 */
export function showFilterBrowser(
  filters: FilterInfoMessage[],
  onSelect: FilterSelectCallback
): FilterBrowser {
  const browser = new FilterBrowser({
    onSelect,
    onClose: () => {},
  });

  browser.show(filters);
  return browser;
}
