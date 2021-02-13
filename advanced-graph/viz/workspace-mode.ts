import type {IAGMode} from '../interfaces';
import type {EventNames, EventObject, NodeSingular} from 'cytoscape';
import type {AdvancedGraph} from './visualization';
import type {NodeCollection} from 'cytoscape';
import type {Menu} from 'obsidian';
import Toolbar from '../ui/Toolbar.svelte';
import {Component} from 'obsidian';
import {VizId} from '../interfaces';
import {
  AG_VIEW_TYPE,
  CLASS_ACTIVE_FILE,
  CLASS_CONNECTED_ACTIVE_FILE, CLASS_EXPANDED,
  CLASS_INACTIVE_FILE, CLASS_PINNED, CLASS_PROTECTED,
  VIEWPORT_ANIMATION_TIME,
} from '../constants';
import type {Core} from 'cytoscape';
import type {SvelteComponent} from 'svelte';
import {
  ColaGlobalLayout,
  ConcentricLayout,
  DagreGlobalLayout,
  GridGlobalLayout,
} from './layout-settings';


class EventRec {
  eventName: EventNames;
  selector: string;
  event: any;
}

export class WorkspaceMode extends Component implements IAGMode {
  view;
  viz: Core;
  events: EventRec[] = [];
  windowEvent: any;
  toolbar: SvelteComponent;
  recursionPreventer = false;
  constructor(view: AdvancedGraph) {
    super();
    this.view = view;
  }

  onload() {
    if (this.view.vizReady) {
      this._onLoad();
    } else {
      this.registerEvent(this.view.on('vizReady', (viz) => {
        this._onLoad();
      }));
    }
  }

  _onLoad() {
    this.viz = this.view.viz;
    this.registerCyEvent('tap', 'node', async (e: EventObject) => {
      const id = VizId.fromNode(e.target);
      if (!(id.storeId === 'core')) {
        return;
      }
      this.updateActiveFile(e.target, true);
    });

    this.registerCyEvent('dblclick', 'node', async (e: EventObject) => {
      await this.view.expand(e.target as NodeSingular);
    });

    this.registerCyEvent('tapselect tapunselect boxselect', null, (e: EventObject) => {
      this.view.trigger('selectChange');
    });

    // Register on file open event
    this.registerEvent(this.view.workspace.on('file-open', async (file) => {
      if (!this.view.settings.autoAddNodes) {
        return;
      }
      if (file && this.view.settings.autoAddNodes) {
        const name = file.basename;
        const id = new VizId(name, 'core');
        let followImmediate = true;
        if (this.viz.$id(id.toId()).length === 0) {
          for (const dataStore of this.view.datastores) {
            if (dataStore.storeId() === 'core') {
              const node = await dataStore.get(id);
              this.viz.startBatch();
              // Make sure it doesn't immediately get removed
              this.viz.add(node).addClass(CLASS_PROTECTED);
              const edges = await this.view.buildEdges(this.viz.$id(id.toId()));
              this.viz.add(edges);
              this.view.onGraphChanged(false);
              this.viz.endBatch();
              followImmediate = false;
              break;
            }
          }
        }
        const node = this.viz.$id(id.toId()) as NodeSingular;
        node.addClass(CLASS_PROTECTED);

        this.updateActiveFile(node, followImmediate);
      }
    }));

    this.registerEvent(this.view.on('expand', (expanded) => {
      this.updateActiveFile(expanded, false);
    }));

    this.registerEvent(this.view.on('elementsChange', () => {
      if (this.recursionPreventer) {
        return;
      }
      // Remove nodes that are not protected and not connected to expanded nodes
      this.viz.nodes()
          .difference(this.viz.nodes(`.${CLASS_PROTECTED}`))
          .filter((ele) => {
            // If none in the closed neighborhood are expanded.
            // Note that the closed neighborhood includes the current note.
            return ele.closedNeighborhood(`node.${CLASS_PROTECTED}`).length === 0;
          })
          .remove();
      this.recursionPreventer = true;
      this.view.onGraphChanged();
      this.recursionPreventer = false;
    }));

    this.windowEvent = async (evt: KeyboardEvent) => {
      if (!(document.activeElement === this.view.element)) {
        return;
      }
      if (evt.key === 'e') {
        await this.expandSelection();
      } else if (evt.key === 'h' || evt.key === 'Backspace') {
        this.removeSelection();
      } else if (evt.key === 'i') {
        this.invertSelection();
      } else if (evt.key === 'a') {
        this.selectAll();
      } else if (evt.key === 'n') {
        this.selectNeighbourhood();
      } else if (evt.key === 'p') {
        this.pinSelection();
      } else if (evt.key === 'u') {
        this.unpinSelection();
      } else if (evt.key === 'c') {
        this.collapseSelection();
      }
    };
    // // Register keypress event
    // Note: Registered on window because it wouldn't fire on the div...
    document.on('keydown', '.cy-content', this.windowEvent, true);
  }

  registerCyEvent(name: EventNames, selector: string, callback: any) {
    this.events.push({eventName: name, selector: selector, event: callback});
    if (selector) {
      this.viz.on(name, selector, callback);
    } else {
      this.viz.on(name, callback);
    }
  }

  onunload(): void {
    for (const listener of this.events) {
      if (listener.selector) {
        this.viz.off(listener.eventName, listener.selector, listener.event);
      } else {
        this.viz.off(listener.eventName, listener.event);
      }
    }
    this.events = [];
    document.off('keydown', '.cy-content', this.windowEvent, true);
    this.toolbar.$destroy();
  }

  getName(): string {
    return 'workspace';
  }

  fillMenu(menu: Menu): void {
    const selection = this.viz.nodes(':selected');
    if (selection.length > 0) {
      menu.addItem((item) => {
        item.setTitle('Expand selection (E)').setIcon('ag-expand')
            .onClick(async (evt) => {
              await this.expandSelection();
            });
      });
      menu.addItem((item) => {
        item.setTitle('Collapse selection (C)').setIcon('ag-collapse')
            .onClick((evt) =>{
              this.collapseSelection();
            });
      });
      menu.addItem((item) => {
        item.setTitle('Hide selection (H)').setIcon('ag-hide')
            .onClick((evt) => {
              this.removeSelection();
            });
      });
      menu.addItem((item) =>{
        item.setTitle('Select all (A)').setIcon('ag-select-all')
            .onClick((evt) => {
              this.selectAll();
            });
      });
      menu.addItem((item) => {
        item.setTitle('Invert selection (I)').setIcon('ag-select-inverse')
            .onClick((evt) => {
              this.invertSelection();
            });
      });
    }
    if (selection.length > 0) {
      menu.addItem((item) => {
        item.setTitle('Select neighbors (N)').setIcon('ag-select-neighbors')
            .onClick((evt) => {
              this.selectNeighbourhood();
            });
      });
      const pinned = this.view.getPinned();
      if (selection.difference(pinned).length > 0) {
        menu.addItem((item) => {
          item.setTitle('Pin selection (P)').setIcon('ag-lock')
              .onClick((evt) => {
                this.pinSelection();
              });
        });
      }
      if (selection.intersect(pinned).length > 0) {
        menu.addItem((item) => {
          item.setTitle('Unpin selection (U)').setIcon('ag-unlock')
              .onClick((evt) => {
                this.unpinSelection();
              });
        });
      }
    }
  }

  createToolbar(element: Element) {
    this.toolbar = new Toolbar({
      target: element,
      props: {
        viz: this.viz,
        expandClick: this.expandSelection.bind(this),
        fdgdClick: () => this.view.setLayout(new ColaGlobalLayout()),
        concentricClick: () => this.view.setLayout(new ConcentricLayout()),
        gridClick: () => this.view.setLayout(new GridGlobalLayout()),
        hierarchyClick: () => this.view.setLayout(new DagreGlobalLayout()),
        collapseClick: this.collapseSelection.bind(this),
        hideClick: this.removeSelection.bind(this),
        selectAllClick: this.selectAll.bind(this),
        selectInvertClick: this.invertSelection.bind(this),
        selectNeighborClick: this.selectNeighbourhood.bind(this),
        lockClick: this.pinSelection.bind(this),
        unlockClick: this.unpinSelection.bind(this),
        fitClick: this.view.fitView.bind(this.view),
        localModeClick: () => this.view.setMode('local'),
        filterInput: (handler: InputEvent) => {
          // @ts-ignore
          this.view.searchFilter(handler.target.value);
        },
      },
    });
    this.view.on('selectChange', this.toolbar.onSelect.bind(this.toolbar));
    this.view.on('vizReady', (viz) => {
      this.toolbar.$set({viz: viz});
      this.toolbar.onSelect.bind(this.toolbar)();
    });
  }

  updateActiveFile(node: NodeCollection, followImmediate: boolean) {
    this.viz.elements()
        .removeClass([CLASS_CONNECTED_ACTIVE_FILE, CLASS_ACTIVE_FILE, CLASS_INACTIVE_FILE])
        .difference(node.closedNeighborhood())
        .addClass(CLASS_INACTIVE_FILE);
    node.addClass(CLASS_ACTIVE_FILE);
    const neighbourhood = node.connectedEdges()
        .addClass(CLASS_CONNECTED_ACTIVE_FILE)
        .connectedNodes()
        .addClass(CLASS_CONNECTED_ACTIVE_FILE)
        .union(node);
    if (followImmediate) {
      this.viz.animate({
        fit: {
          eles: neighbourhood,
          padding: 0,
        },
        duration: VIEWPORT_ANIMATION_TIME,
        queue: false,
      });
    }
    this.viz.one('tap', (e) => {
      e.cy.elements().removeClass(['connected-active-file', 'active-file', 'inactive-file']);
    });
  }

  async expandSelection() {
    await this.view.expand(this.viz.nodes(':selected'));
  }

  collapseSelection() {
    const selectedProtected = this.viz.nodes(`:selected.${CLASS_PROTECTED}`)
        .removeClass([CLASS_PROTECTED, CLASS_EXPANDED]);
    selectedProtected.openNeighborhood()
        .nodes()
        .filter((ele) => {
          // If none in the closed neighborhood are protected that aren't also selected
          // (their PROTECTED flag has been removed)
          return ele.closedNeighborhood(`node.${CLASS_PROTECTED}`).length === 0;
        })
        .remove();
    // can this cause race conditions with on elementsChange?
    this.recursionPreventer = true;
    this.view.onGraphChanged();
    this.recursionPreventer = false;
  }

  removeSelection() {
    const removed = this.view.removeNodes(this.viz.nodes(':selected'));
    this.view.trigger('hide', removed);
    this.view.trigger('selectChange');
  }

  selectAll() {
    this.viz.nodes().select();
    this.view.trigger('selectChange');
  }

  invertSelection() {
    this.viz.$(':selected')
        .unselect()
        .absoluteComplement()
        .select();
    this.view.trigger('selectChange');
  }

  selectNeighbourhood() {
    // TODO: This keeps self-loops selected.
    this.viz.nodes(':selected')
        .unselect()
        .openNeighborhood()
        .select();
    this.view.trigger('selectChange');
  }

  unpinSelection() {
    const unlocked = this.viz.nodes(':selected')
        .unlock()
        .removeClass(CLASS_PINNED);
    this.view.restartLayout();
    this.view.trigger('unpin', unlocked);
  }

  pinSelection() {
    const locked = this.viz.nodes(':selected')
        .lock()
        .addClass(CLASS_PINNED);
    this.view.restartLayout();
    this.view.trigger('pin', locked);
  }
}