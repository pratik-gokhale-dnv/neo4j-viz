/**
 * Neo4j Viz - Interactive Graph Explorer
 * Force-directed graph with curved arc links, directed arrows,
 * node sizing by degree, pin/unpin on double-click, zoom, search, and filter.
 * Visual style inspired by CSE-6242 D3 graph visualization.
 */

(function () {
  "use strict";

  // ─── State ──────────────────────────────────────────────────────────────────
  const state = {
    nodes: [],
    links: [],
    simulation: null,
    svg: null,
    g: null,
    zoom: null,
    selectedNode: null,
    hiddenLabels: new Set(),
    colorScale: d3.scaleOrdinal(d3.schemeTableau10),
    linkColorScale: d3.scaleOrdinal(d3.schemeSet2),
    pathElements: null,
    nodeGroups: null,
  };

  // ─── DOM References ─────────────────────────────────────────────────────────
  const $graph = document.getElementById("graph");
  const $status = document.getElementById("status");
  const $searchInput = document.getElementById("search-input");
  const $labelFilter = document.getElementById("label-filter");
  const $limitInput = document.getElementById("limit-input");
  const $sidePanel = document.getElementById("side-panel");
  const $panelTitle = document.getElementById("panel-title");
  const $panelContent = document.getElementById("panel-content");
  const $tooltip = document.getElementById("tooltip");
  const $contextMenu = document.getElementById("context-menu");
  const $loading = document.getElementById("loading");
  const $legendItems = document.getElementById("legend-items");
  const $linkLegendItems = document.getElementById("link-legend-items");

  // ─── Initialization ─────────────────────────────────────────────────────────
  function init() {
    const width = window.innerWidth;
    const height = window.innerHeight - 48;

    state.svg = d3.select($graph).attr("width", width).attr("height", height);

    // Zoom behavior
    state.zoom = d3
      .zoom()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        state.g.attr("transform", event.transform);
      });

    state.svg.call(state.zoom);
    state.svg.on("click", onCanvasClick);
    state.svg.on("contextmenu", (e) => e.preventDefault());

    // Main group that gets transformed by zoom
    state.g = state.svg.append("g");

    // Arrow marker for directed edges
    state.svg
      .append("defs")
      .selectAll("marker")
      .data(["end"])
      .join("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 15)
      .attr("refY", -1.5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#666");

    // Event listeners
    document.getElementById("btn-load").addEventListener("click", loadGraph);
    document.getElementById("btn-fit").addEventListener("click", fitGraph);
    document.getElementById("btn-reset").addEventListener("click", resetZoom);
    document.getElementById("btn-export").addEventListener("click", exportSVG);
    document.getElementById("btn-pin-all").addEventListener("click", pinAll);
    document.getElementById("btn-unpin-all").addEventListener("click", unpinAll);
    document.getElementById("panel-close").addEventListener("click", closePanel);
    $searchInput.addEventListener("input", debounce(onSearch, 300));
    $labelFilter.addEventListener("change", onLabelFilter);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", hideContextMenu);

    // Handle window resize
    window.addEventListener("resize", () => {
      const w = window.innerWidth;
      const h = window.innerHeight - 48;
      state.svg.attr("width", w).attr("height", h);
    });

    // Load graph on start
    loadGraph();
  }

  // ─── Data Loading ───────────────────────────────────────────────────────────
  async function loadGraph() {
    showLoading(true);
    const limit = parseInt($limitInput.value) || 100;

    try {
      const res = await fetch(`/api/graph?limit=${limit}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to load graph");
      }

      const data = await res.json();
      state.nodes = data.nodes || [];
      state.links = data.links || [];

      // Compute degree for each node (used for sizing)
      computeDegrees();

      $status.textContent = `${state.nodes.length} nodes, ${state.links.length} relationships`;

      buildLegend();
      buildLinkLegend();
      populateLabelFilter();
      renderGraph();
    } catch (err) {
      $status.textContent = err.message;
    } finally {
      showLoading(false);
    }
  }

  async function expandNode(nodeId) {
    showLoading(true);
    try {
      const res = await fetch(`/api/neighbors/${encodeURIComponent(nodeId)}`);
      if (!res.ok) return;

      const data = await res.json();
      const existingIds = new Set(state.nodes.map((n) => n.id));

      let added = 0;
      for (const node of data.nodes) {
        if (!existingIds.has(node.id)) {
          state.nodes.push(node);
          existingIds.add(node.id);
          added++;
        }
      }

      const existingLinks = new Set(
        state.links.map(
          (l) =>
            `${l.source.id || l.source}-${l.target.id || l.target}-${l.type}`
        )
      );

      for (const link of data.links) {
        const key = `${link.source}-${link.target}-${link.type}`;
        if (
          !existingLinks.has(key) &&
          existingIds.has(link.source) &&
          existingIds.has(link.target)
        ) {
          state.links.push(link);
          existingLinks.add(key);
        }
      }

      if (added > 0) {
        computeDegrees();
        $status.textContent = `Expanded: +${added} nodes. Total: ${state.nodes.length} nodes, ${state.links.length} links`;
        buildLegend();
        buildLinkLegend();
        populateLabelFilter();
        renderGraph();
      } else {
        $status.textContent = "No new neighbors found";
      }
    } catch (err) {
      $status.textContent = "Expand failed: " + err.message;
    } finally {
      showLoading(false);
    }
  }

  // ─── Compute degrees ────────────────────────────────────────────────────────
  function computeDegrees() {
    const degreeMap = {};
    state.nodes.forEach((n) => (degreeMap[n.id] = 0));
    state.links.forEach((l) => {
      const sid = l.source.id || l.source;
      const tid = l.target.id || l.target;
      if (degreeMap[sid] !== undefined) degreeMap[sid]++;
      if (degreeMap[tid] !== undefined) degreeMap[tid]++;
    });
    state.nodes.forEach((n) => (n.degree = degreeMap[n.id] || 0));
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────
  function renderGraph() {
    state.g.selectAll("*").remove();

    // Filter out hidden labels
    const visibleNodes = state.nodes.filter(
      (n) => !state.hiddenLabels.has(n.labels ? n.labels[0] : n.label)
    );
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleLinks = state.links.filter(
      (l) =>
        visibleIds.has(l.source.id || l.source) &&
        visibleIds.has(l.target.id || l.target)
    );

    // Curved arc links (SVG paths) with arrows - like the reference
    state.pathElements = state.g
      .append("g")
      .attr("class", "links")
      .selectAll("path")
      .data(visibleLinks)
      .join("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", (d) => getLinkColor(d.type))
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    // Node groups (circle + label)
    state.nodeGroups = state.g
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(visibleNodes)
      .join("g")
      .attr("class", "node")
      .on("mouseover", onNodeHover)
      .on("mouseout", onNodeHoverOut)
      .on("click", onNodeClick)
      .on("dblclick", onNodeDblClick)
      .on("contextmenu", onNodeRightClick)
      .call(dragBehavior());

    // Node circles - size by degree (like reference: 3 * sqrt(weight))
    state.nodeGroups
      .append("circle")
      .attr("class", (d) => "node-circle" + (d.fx !== undefined && d.fx !== null ? " pinned" : ""))
      .attr("r", (d) => nodeRadius(d));

    // Node labels
    state.nodeGroups
      .append("text")
      .attr("class", "node-label")
      .attr("dx", (d) => nodeRadius(d) + 4)
      .attr("dy", 4)
      .text((d) => getNodeDisplayName(d));

    // Force simulation
    if (state.simulation) state.simulation.stop();

    state.simulation = d3
      .forceSimulation(visibleNodes)
      .force(
        "link",
        d3
          .forceLink(visibleLinks)
          .id((d) => d.id)
          .distance(60)
      )
      .force("charge", d3.forceManyBody().strength(-250))
      .force(
        "center",
        d3.forceCenter(
          parseInt(state.svg.attr("width")) / 2,
          parseInt(state.svg.attr("height")) / 2
        )
      )
      .force("collision", d3.forceCollide().radius((d) => nodeRadius(d) + 3))
      .on("tick", tick);
  }

  // ─── Tick: curved arcs like the reference ───────────────────────────────────
  function tick() {
    // Draw curved arcs between source and target
    state.pathElements.attr("d", (d) => {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const dr = Math.sqrt(dx * dx + dy * dy);
      return (
        "M" +
        d.source.x +
        "," +
        d.source.y +
        "A" +
        dr +
        "," +
        dr +
        " 0 0,1 " +
        d.target.x +
        "," +
        d.target.y
      );
    });

    state.nodeGroups.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  // ─── Link color by relationship type ────────────────────────────────────────
  function getLinkColor(type) {
    return state.linkColorScale(type);
  }

  // ─── Drag ───────────────────────────────────────────────────────────────────
  function dragBehavior() {
    return d3
      .drag()
      .on("start", (event, d) => {
        if (!event.active) state.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) state.simulation.alphaTarget(0);
        // Keep node at dragged position (pinned by default)
        d.fx = event.x;
        d.fy = event.y;
      });
  }

  // ─── Node interactions ──────────────────────────────────────────────────────
  function onNodeHover(event, d) {
    const label = d.labels ? d.labels[0] : d.label;
    const name = getNodeDisplayName(d);
    $tooltip.innerHTML = `<span class="label">${label}</span><br/>${name}<br/><small>${d.degree} connection${d.degree !== 1 ? "s" : ""}</small>`;
    $tooltip.style.left = event.clientX + 12 + "px";
    $tooltip.style.top = event.clientY - 10 + "px";
    $tooltip.classList.add("visible");

    highlightNeighbors(d);
  }

  function onNodeHoverOut() {
    $tooltip.classList.remove("visible");
    if (!state.selectedNode) {
      clearHighlight();
    }
  }

  function onNodeClick(event, d) {
    event.stopPropagation();
    state.selectedNode = d;
    highlightNeighbors(d);
    showNodeDetails(d);
  }

  // Double-click: toggle pin/unpin (like the reference - turns pink when pinned)
  function onNodeDblClick(event, d) {
    event.stopPropagation();
    if (d.fx !== null && d.fx !== undefined) {
      // Unpin
      d.fx = null;
      d.fy = null;
      d3.select(event.currentTarget)
        .select("circle")
        .classed("pinned", false);
      state.simulation.alpha(0.1).restart();
      $status.textContent = `Unpinned: ${getNodeDisplayName(d)}`;
    } else {
      // Pin
      d.fx = d.x;
      d.fy = d.y;
      d3.select(event.currentTarget)
        .select("circle")
        .classed("pinned", true);
      $status.textContent = `Pinned: ${getNodeDisplayName(d)}`;
    }
  }

  function onNodeRightClick(event, d) {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event, d);
  }

  function onCanvasClick() {
    state.selectedNode = null;
    clearHighlight();
    closePanel();
    hideContextMenu();
  }

  // ─── Highlight neighbors ───────────────────────────────────────────────────
  function highlightNeighbors(d) {
    const neighborIds = new Set();
    const linkIndices = new Set();

    state.links.forEach((l, i) => {
      const sourceId = l.source.id || l.source;
      const targetId = l.target.id || l.target;
      if (sourceId === d.id || targetId === d.id) {
        neighborIds.add(sourceId);
        neighborIds.add(targetId);
        linkIndices.add(i);
      }
    });
    neighborIds.add(d.id);

    state.nodeGroups
      .classed("dimmed", (n) => !neighborIds.has(n.id))
      .select("circle")
      .classed("node-highlight", (n) => n.id === d.id);

    state.pathElements
      .classed("dimmed", (l, i) => !linkIndices.has(i))
      .classed("link-highlight", (l, i) => linkIndices.has(i));
  }

  function clearHighlight() {
    if (state.nodeGroups) {
      state.nodeGroups.classed("dimmed", false).select("circle").classed("node-highlight", false);
    }
    if (state.pathElements) {
      state.pathElements.classed("dimmed", false).classed("link-highlight", false);
    }
  }

  // ─── Side Panel ─────────────────────────────────────────────────────────────
  function showNodeDetails(d) {
    const label = d.labels ? d.labels.join(", ") : d.label;
    $panelTitle.textContent = label;

    let html = '<table class="property-table">';
    html += `<tr><td>ID</td><td>${escapeHtml(d.id)}</td></tr>`;
    html += `<tr><td>Labels</td><td>${escapeHtml(label)}</td></tr>`;
    html += `<tr><td>Degree</td><td>${d.degree}</td></tr>`;
    html += `<tr><td>Pinned</td><td>${d.fx !== null && d.fx !== undefined ? "Yes" : "No"}</td></tr>`;

    const props = d.properties || {};
    for (const [key, value] of Object.entries(props)) {
      const displayVal =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      html += `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(displayVal)}</td></tr>`;
    }
    html += "</table>";

    html += `<div style="margin-top: 12px;">
      <button onclick="window.__expandNode('${d.id}')" style="font-size:12px; padding:4px 8px; background:#4263eb; color:#fff; border:none; border-radius:4px; cursor:pointer;">
        Expand Neighbors
      </button>
      <button onclick="window.__removeNode('${d.id}')" style="font-size:12px; padding:4px 8px; background:#c92a2a; color:#fff; border:none; border-radius:4px; cursor:pointer; margin-left:4px;">
        Remove Node
      </button>
    </div>`;

    $panelContent.innerHTML = html;
    $sidePanel.classList.add("open");
  }

  function closePanel() {
    $sidePanel.classList.remove("open");
  }

  // ─── Context Menu ───────────────────────────────────────────────────────────
  function showContextMenu(event, d) {
    hideContextMenu();
    const isPinned = d.fx !== null && d.fx !== undefined;
    const items = [
      { label: "Expand Neighbors", action: () => expandNode(d.id) },
      {
        label: isPinned ? "Unpin Node" : "Pin Node",
        action: () => {
          if (isPinned) {
            d.fx = null;
            d.fy = null;
            state.simulation.alpha(0.1).restart();
          } else {
            d.fx = d.x;
            d.fy = d.y;
          }
          renderGraph();
        },
      },
      { label: "Remove Node", action: () => removeNode(d.id) },
      {
        label: "View Details",
        action: () => {
          showNodeDetails(d);
          state.selectedNode = d;
          highlightNeighbors(d);
        },
      },
    ];

    $contextMenu.innerHTML = items
      .map((item) => `<div class="context-menu-item">${item.label}</div>`)
      .join("");

    $contextMenu.querySelectorAll(".context-menu-item").forEach((el, i) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        items[i].action();
        hideContextMenu();
      });
    });

    $contextMenu.style.left = event.clientX + "px";
    $contextMenu.style.top = event.clientY + "px";
    $contextMenu.classList.add("visible");
  }

  function hideContextMenu() {
    $contextMenu.classList.remove("visible");
  }

  // ─── Search ─────────────────────────────────────────────────────────────────
  function onSearch() {
    const query = $searchInput.value.trim().toLowerCase();
    if (!query) {
      clearHighlight();
      return;
    }

    const matchIds = new Set();
    state.nodes.forEach((n) => {
      const name = getNodeDisplayName(n).toLowerCase();
      const label = (n.labels ? n.labels[0] : n.label || "").toLowerCase();
      if (name.includes(query) || label.includes(query)) {
        matchIds.add(n.id);
      }
      // Search properties
      const props = n.properties || {};
      for (const val of Object.values(props)) {
        if (String(val).toLowerCase().includes(query)) {
          matchIds.add(n.id);
          break;
        }
      }
    });

    if (state.nodeGroups) {
      state.nodeGroups.classed("dimmed", (n) => !matchIds.has(n.id));
      state.pathElements.classed("dimmed", () => true);
    }

    $status.textContent = `Found ${matchIds.size} matching nodes`;
  }

  // ─── Label Filter ───────────────────────────────────────────────────────────
  function onLabelFilter() {
    const selected = $labelFilter.value;
    if (!selected) {
      state.hiddenLabels.clear();
    } else {
      const allLabels = getAllLabels();
      state.hiddenLabels.clear();
      allLabels.forEach((l) => {
        if (l !== selected) state.hiddenLabels.add(l);
      });
    }
    renderGraph();
  }

  function populateLabelFilter() {
    const labels = getAllLabels();
    $labelFilter.innerHTML = '<option value="">All Labels</option>';
    labels.forEach((label) => {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = `${label} (${countByLabel(label)})`;
      $labelFilter.appendChild(opt);
    });
  }

  // ─── Legend ─────────────────────────────────────────────────────────────────
  function buildLegend() {
    const labels = getAllLabels();
    $legendItems.innerHTML = "";

    labels.forEach((label) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<div class="swatch" style="background:${state.colorScale(label)}"></div><span>${label} (${countByLabel(label)})</span>`;
      item.addEventListener("click", () => toggleLabel(label, item));
      $legendItems.appendChild(item);
    });
  }

  function buildLinkLegend() {
    const types = getAllLinkTypes();
    $linkLegendItems.innerHTML = "";

    types.forEach((type) => {
      const item = document.createElement("div");
      item.className = "link-legend-item";
      item.innerHTML = `<div class="line-swatch" style="background:${state.linkColorScale(type)}"></div><span>${type}</span>`;
      $linkLegendItems.appendChild(item);
    });
  }

  function toggleLabel(label, item) {
    if (state.hiddenLabels.has(label)) {
      state.hiddenLabels.delete(label);
      item.classList.remove("dimmed");
    } else {
      state.hiddenLabels.add(label);
      item.classList.add("dimmed");
    }
    renderGraph();
  }

  // ─── Zoom Controls ─────────────────────────────────────────────────────────
  function fitGraph() {
    if (!state.nodes.length) return;
    const bounds = state.g.node().getBBox();
    const width = parseInt(state.svg.attr("width"));
    const height = parseInt(state.svg.attr("height"));
    const dx = bounds.width;
    const dy = bounds.height;
    const x = bounds.x + dx / 2;
    const y = bounds.y + dy / 2;
    const scale = 0.85 / Math.max(dx / width, dy / height);
    const translate = [width / 2 - scale * x, height / 2 - scale * y];

    state.svg
      .transition()
      .duration(750)
      .call(
        state.zoom.transform,
        d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
      );
  }

  function resetZoom() {
    state.svg
      .transition()
      .duration(500)
      .call(state.zoom.transform, d3.zoomIdentity);
  }

  // ─── Export ─────────────────────────────────────────────────────────────────
  function exportSVG() {
    const svgClone = $graph.cloneNode(true);
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "neo4j-graph.svg";
    a.click();
    URL.revokeObjectURL(url);
    $status.textContent = "Graph exported as SVG";
  }

  // ─── Pin/Unpin All ──────────────────────────────────────────────────────────
  function pinAll() {
    state.nodes.forEach((d) => {
      d.fx = d.x;
      d.fy = d.y;
    });
    if (state.nodeGroups) {
      state.nodeGroups.select("circle").classed("pinned", true);
    }
    $status.textContent = "All nodes pinned";
  }

  function unpinAll() {
    state.nodes.forEach((d) => {
      d.fx = null;
      d.fy = null;
    });
    if (state.nodeGroups) {
      state.nodeGroups.select("circle").classed("pinned", false);
    }
    if (state.simulation) state.simulation.alpha(0.3).restart();
    $status.textContent = "All nodes unpinned";
  }

  // ─── Remove node ───────────────────────────────────────────────────────────
  function removeNode(nodeId) {
    state.nodes = state.nodes.filter((n) => n.id !== nodeId);
    state.links = state.links.filter((l) => {
      const sourceId = l.source.id || l.source;
      const targetId = l.target.id || l.target;
      return sourceId !== nodeId && targetId !== nodeId;
    });
    state.selectedNode = null;
    closePanel();
    computeDegrees();
    buildLegend();
    buildLinkLegend();
    renderGraph();
    $status.textContent = `Removed node. ${state.nodes.length} nodes remaining`;
  }

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────
  function onKeyDown(event) {
    if (event.key === "Escape") {
      state.selectedNode = null;
      clearHighlight();
      closePanel();
      hideContextMenu();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "f") {
      event.preventDefault();
      $searchInput.focus();
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function getAllLabels() {
    const labels = new Set();
    state.nodes.forEach((n) => {
      const label = n.labels ? n.labels[0] : n.label;
      if (label) labels.add(label);
    });
    return Array.from(labels).sort();
  }

  function getAllLinkTypes() {
    const types = new Set();
    state.links.forEach((l) => {
      if (l.type) types.add(l.type);
    });
    return Array.from(types).sort();
  }

  function countByLabel(label) {
    return state.nodes.filter(
      (n) => (n.labels ? n.labels[0] : n.label) === label
    ).length;
  }

  // Node radius scaled by degree (like reference: 3 * sqrt(weight))
  function nodeRadius(d) {
    const degree = d.degree || 1;
    return Math.max(5, 3 * Math.sqrt(degree));
  }

  function getNodeDisplayName(d) {
    const props = d.properties || {};
    return (
      props.name ||
      props.title ||
      props.label ||
      props.displayName ||
      props.username ||
      props.email ||
      (d.labels ? d.labels[0] : d.label) ||
      d.id
    );
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function showLoading(show) {
    $loading.classList.toggle("visible", show);
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ─── Global functions for panel buttons ─────────────────────────────────────
  window.__expandNode = function (id) {
    expandNode(id);
  };
  window.__removeNode = function (id) {
    removeNode(id);
  };

  // ─── Start ──────────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
