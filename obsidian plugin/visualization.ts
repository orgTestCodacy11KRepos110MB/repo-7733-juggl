// import NeoVis from 'neovis.js/dist/neovis.js';
import {NEOVIS_DEFAULT_CONFIG} from "neovis.js";
import NeoVis from 'neovis.js';
import {INeo4jViewSettings} from "./settings";
import {EventRef, ItemView, MarkdownView, normalizePath, TFile, Vault, Workspace, WorkspaceLeaf} from "obsidian";
import Neo4jViewPlugin from "./main";
import {Relationship, Node} from "neo4j-driver";
import {Data, IdType, Network, NodeOptions} from "vis-network";
import {filter} from "rxjs/operators";

export const NV_VIEW_TYPE = "neovis";
export const MD_VIEW_TYPE = 'markdown';

export const PROP_VAULT = "SMD_vault"
export const PROP_PATH = "SMD_path"
export const PROP_COMMUNITY = "SMD_community"

export class NeoVisView extends ItemView{

    workspace: Workspace;
    listeners: EventRef[];
    settings: INeo4jViewSettings;
    initial_note: string;
    vault: Vault;
    plugin: Neo4jViewPlugin;
    viz: NeoVis;
    network: Network;
    hasClickListener = false;
    rebuildRelations = true;

    constructor(leaf: WorkspaceLeaf, active_note: string, plugin: Neo4jViewPlugin) {
        super(leaf);
        this.settings = plugin.settings;
        this.workspace = this.app.workspace;
        this.initial_note = active_note;
        this.vault = this.app.vault;
        this.plugin = plugin;
    }

    async onOpen() {
        // this.registerInterval(window.setInterval(()=> this.checkAndUpdate));
        this.listeners = [
            this.workspace.on('layout-ready', () => this.update()),
            this.workspace.on('resize', () => this.update()),
            this.workspace.on('css-change', () => this.update()),
            // this.leaf.on('group-change', (group) => this.updateLinkedLeaf(group, this))
        ];

        const div = document.createElement("div");
        div.id = "neovis_id";
        this.containerEl.children[1].appendChild(div);
        div.setAttr("style", "height: 100%; width:100%");
        // console.log(this.containerEl);
        const config = {
            container_id: "neovis_id",
            server_url: "bolt://localhost:7687",
            server_user: "neo4j",
            server_password: this.settings.password,
            arrows: this.settings.show_arrows, // TODO: ADD CONFIG
            hierarchical: this.settings.hierarchical,
            labels: {
                [NEOVIS_DEFAULT_CONFIG]: {
                    "caption": "name",
                    //"size": this.settings.node_size,
                    "community": PROP_COMMUNITY,
                    "title_properties": [
                        "aliases",
                        "content"
                    ],
                    // "font": {
                    //     "size": this.settings.font_size,
                    //     "strokeWidth": this.settings.font_stroke_width
                    // }
                    //"sizeCypher": "defaultSizeCypher"

                }
            },
            relationships: {
                "inline": {
                    "thickness": "weight",
                    "caption": false
                },
                [NEOVIS_DEFAULT_CONFIG]: {
                    "thickness": "defaultThicknessProperty",
                    "caption": true
                }
            },
            initial_cypher: this.settings.auto_expand ?
                this.localNeighborhoodCypher(this.initial_note) :
                this.nodeCypher(this.initial_note)
        };
        this.viz = new NeoVis(config);
        this.viz.registerOnEvent("completed", (e)=>{

            if (!this.hasClickListener) {
                // @ts-ignore
                this.network = this.viz["_network"] as Network;
                // Register on click event
                this.network.on("click", (event) => {
                    if (event.nodes.length > 0) {
                        this.onClickNode(this.findNode(event.nodes[0]));
                    }
                    else if (event.edges.length == 1) {
                        this.onClickEdge(this.findEdge(event.edges[0]));
                    }
                });
                this.network.on("doubleClick", (event) => {
                    if (event.nodes.length > 0) {
                        this.onDoubleClickNode(this.findNode(event.nodes[0]));
                    }
                });
                this.hasClickListener = true;
            }
            if (this.rebuildRelations) {
                let inQuery = this.getInQuery(this.viz.nodes.getIds());
                let query = "MATCH (n)-[r]-(m) WHERE n." + PROP_VAULT + "= \"" + this.vault.getName() + "\" AND n.name " + inQuery
                    + " AND  m." + PROP_VAULT + "= \"" + this.vault.getName() + "\" AND m.name " + inQuery +
                    " RETURN r";
                this.viz.updateWithCypher(query);
                this.rebuildRelations = false;
            }
            this.updateStyle();
        });
        this.load();
        this.viz.render();

        // Register on file open event
        this.workspace.on("file-open", (file) => {
            if (file && this.settings.auto_add_nodes) {
                const name = file.basename;
                if (this.settings.auto_expand) {
                    this.updateWithCypher(this.localNeighborhoodCypher(name));
                }
                else {
                    this.updateWithCypher(this.nodeCypher(name));
                }
            }
        });

        // Register keypress event
        this.containerEl.addEventListener("keydown", (evt) => {
            if (evt.key === "e"){
                this.expandSelection();
            }
            else if (evt.key === "h" || evt.key === "Backspace"){
                this.hideSelection();
            }
            else if (evt.key === "i") {
                this.invertSelection();
            }
            else if (evt.key === "a") {
                this.selectAll();
            }
        });
    }

    nodeCypher(label: string): string {
        return "MATCH (n) WHERE n.name=\"" + label +
            "\" AND n." + PROP_VAULT + "=\"" + this.vault.getName() +
            "\" RETURN n"
    }

    localNeighborhoodCypher(label:string): string {
        return "MATCH (n)-[r]-(m) WHERE n.name=\"" + label +
            "\" AND n." + PROP_VAULT + "=\"" + this.vault.getName() +
            "\" RETURN n,r,m"
    }

    findNode(id: IdType): Node {
        // @ts-ignore
        return this.viz.nodes.get(id)?.raw as Node;
    }

    findEdge(id: IdType): Relationship {
        // @ts-ignore
        return this.viz.edges.get(id)?.raw as Relationship;
    }

    getInQuery(nodes: IdType[]): string {
        let query = "IN ["
        let first = true;
        for (let id of nodes) {
            // @ts-ignore
            const title = this.findNode(id).properties["name"] as string;
            if (!first) {
                query += ", ";
            }
            query += "\"" + title + "\"";
            first = false;
        }
        query += "]"
        return query;
    }

    updateWithCypher(cypher: string) {
        this.viz.updateWithCypher(cypher);
        this.rebuildRelations = true;
    }

    updateStyle() {
        let nodeOptions = JSON.parse(this.settings.nodeSettings);
        this.viz.nodes.forEach((node) => {
            let nodeId = this.network.findNode(node.id);
            // @ts-ignore
            let node_sth = this.network.body.nodes[nodeId];
            let specificOptions: NodeOptions[] = [];
            node.raw.labels.forEach((label) => {
                if (label in nodeOptions) {
                    specificOptions.push(nodeOptions[label]);
                }
            });
            console.log(Object.assign({}, nodeOptions["defaultStyle"], ...specificOptions));
            node_sth.setOptions(Object.assign({}, nodeOptions["defaultStyle"], ...specificOptions));
        });
        let edgeOptions = JSON.parse(this.settings.edgeSettings);
        this.viz.edges.forEach((edge) => {
            // @ts-ignore
            let edge_sth = this.network.body.edges[edge.id];
            let specificOptions = edge.label in edgeOptions ? [edgeOptions[edge.label]] : [];
            console.log(Object.assign({}, edgeOptions["defaultStyle"], ...specificOptions));
            edge_sth.setOptions(Object.assign({}, edgeOptions["defaultStyle"], ...specificOptions));
        })
    }

    async onClickNode(node: Node) {
        // @ts-ignore
        const file = node.properties[PROP_PATH];
        // @ts-ignore
        const label = node.properties["name"];
        if (file) {
            const tfile = this.plugin.getFileFromAbsolutePath(file) as TFile;
            await this.plugin.openFile(tfile)
        }
        else {
            // Create dangling file
            // TODO: Add default folder
            const filename = label + ".md";
            const createdFile = await this.vault.create(filename, '');
            await this.plugin.openFile(createdFile);
        }
        if (this.settings.auto_expand) {
            await this.updateWithCypher(this.localNeighborhoodCypher(label));
        }
    }

    async onDoubleClickNode(node: Node) {
        // @ts-ignore
        const label = node.properties["name"];
        await this.updateWithCypher(this.localNeighborhoodCypher(label));
    }

    async onClickEdge(edge: Object) {
        // @ts-ignore
        // if (!edge.raw) {
        //     return;
        // }
        // // @ts-ignore
        // const rel = edge.raw as Relationship;
        // console.log(edge);
        // // @ts-ignore
        // const file = rel.properties["context"];
        // const node = this.viz.nodes.get(rel.start.high);
        // const label = node.label;

        // TODO: Figure out how to open a node at the context point
        // this.workspace.openLinkText()

    }

    async expandSelection() {
        let selected_nodes = this.network.getSelectedNodes();
        if (selected_nodes.length === 0) {
            return;
        }
        let query = "MATCH (n)-[r]-(m) WHERE n." + PROP_VAULT + "= \"" + this.vault.getName() + "\" AND n.name "
        query += this.getInQuery(selected_nodes);
        query += " RETURN r,m"
        this.updateWithCypher(query);
    }

    async hideSelection() {
        if (this.network.getSelectedNodes().length === 0) {
            return;
        }
        this.network.deleteSelected();

        // This super hacky code is used because neovis.js doesn't like me removing nodes from the graph.
        // Essentially, whenever it'd execute a new query, it'd re-add all hidden nodes!
        // This resets the state of NeoVis so that it only acts as an interface with neo4j instead of also keeping
        // track of the data.
        // @ts-ignore
        let data = {nodes: this.viz.nodes, edges: this.viz.edges} as Data;
        this.viz.clearNetwork();
        this.network.setData(data);
    }

    invertSelection() {
        let selectedNodes = this.network.getSelectedNodes();
        let network = this.network;
        let inversion = this.viz.nodes.get({filter: function(item){
            return !selectedNodes.contains(item.id) && network.findNode(item.id).length > 0;
        }}).map((item) =>  item.id);
        this.network.setSelection({nodes: inversion, edges: []})
    }


    selectAll() {
        this.network.unselectAll();
        this.invertSelection();
    }

    async checkAndUpdate() {
        try {
            if(await this.checkActiveLeaf()) {
                await this.update();
            }
        } catch (error) {
            console.error(error)
        }
    }

    async update(){
        // if(this.filePath) {
        //     await this.readMarkDown();
        //     if(this.currentMd.length === 0 || this.getLeafTarget().view.getViewType() != MD_VIEW_TYPE){
        //         this.displayEmpty(true);
        //         removeExistingSVG();
        //     } else {
        //         const { root, features } = await this.transformMarkdown();
        //         this.displayEmpty(false);
        //         this.svg = createSVG(this.containerEl, this.settings.lineHeight);
        //         this.renderMarkmap(root, this.svg);
        //     }
        // }
        // this.displayText = this.fileName != undefined ? `Mind Map of ${this.fileName}` : 'Mind Map';

        this.load();
    }

    async checkActiveLeaf() {
        // TODO: Wait for callbacks in python
        // if(this.app.workspace.activeLeaf.view.getViewType() === MM_VIEW_TYPE){
        //     return false;
        // }
        // const markDownHasChanged = await this.readMarkDown();
        // const updateRequired = markDownHasChanged;
        return false;
    }

    getDisplayText(): string {
        return "Neo4j Graph";
    }

    getViewType(): string {
        return NV_VIEW_TYPE;
    }


}