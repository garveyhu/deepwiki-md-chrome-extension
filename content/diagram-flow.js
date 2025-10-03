function convertFlowchartSvgToMermaidText(svgElement) {
  if (!svgElement) return null;

  console.log("Starting flowchart conversion with hierarchical logic...");
  let mermaidCode = "flowchart TD\n\n";
  const nodes = {};
  const clusters = {};
  const parentMap = {};
  const allElements = {};

  svgElement.querySelectorAll("g.node").forEach((nodeEl) => {
    const svgId = nodeEl.id;
    if (!svgId) return;

    let textContent = "";
    const pElementForText = nodeEl.querySelector(
      ".label foreignObject div > span > p, .label foreignObject div > p"
    );
    if (pElementForText) {
      let rawParts = [];
      pElementForText.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) rawParts.push(child.textContent);
        else if (child.nodeName.toUpperCase() === "BR") rawParts.push("<br>");
        else if (child.nodeType === Node.ELEMENT_NODE)
          rawParts.push(child.textContent || "");
      });
      textContent = rawParts.join("").trim().replace(/"/g, "#quot;");
    }
    if (!textContent.trim()) {
      const nodeLabel = nodeEl.querySelector(
        ".nodeLabel, .label, foreignObject span, foreignObject div, text"
      );
      if (nodeLabel && nodeLabel.textContent) {
        textContent = nodeLabel.textContent.trim().replace(/"/g, "#quot;");
      }
    }

    let mermaidId = svgId.replace(/^flowchart-/, "").replace(/-\d+$/, "");

    const bbox = nodeEl.getBoundingClientRect();
    if (bbox.width > 0 || bbox.height > 0) {
      nodes[svgId] = {
        type: "node",
        mermaidId: mermaidId,
        text: textContent,
        svgId: svgId,
        bbox: bbox,
      };
      allElements[svgId] = nodes[svgId];
    }
  });

  svgElement.querySelectorAll("g.cluster").forEach((clusterEl) => {
    const svgId = clusterEl.id;
    if (!svgId) return;

    let title = "";
    const labelEl = clusterEl.querySelector(".cluster-label, .label");
    if (labelEl && labelEl.textContent) {
      title = labelEl.textContent.trim();
    }
    if (!title) {
      title = svgId;
    }

    const rect = clusterEl.querySelector("rect");
    const bbox = rect
      ? rect.getBoundingClientRect()
      : clusterEl.getBoundingClientRect();

    if (bbox.width > 0 || bbox.height > 0) {
      clusters[svgId] = {
        type: "cluster",
        mermaidId: svgId,
        title: title,
        svgId: svgId,
        bbox: bbox,
      };
      allElements[svgId] = clusters[svgId];
    }
  });

  for (const childId in allElements) {
    const child = allElements[childId];
    let potentialParentId = null;
    let minArea = Infinity;

    for (const parentId in clusters) {
      if (childId === parentId) continue;
      const parent = clusters[parentId];

      if (
        child.bbox.left >= parent.bbox.left &&
        child.bbox.right <= parent.bbox.right &&
        child.bbox.top >= parent.bbox.top &&
        child.bbox.bottom <= parent.bbox.bottom
      ) {
        const area = parent.bbox.width * parent.bbox.height;
        if (area < minArea) {
          minArea = area;
          potentialParentId = parentId;
        }
      }
    }
    if (potentialParentId) {
      parentMap[childId] = potentialParentId;
    }
  }

  const edges = [];
  const edgeLabels = {};
  svgElement.querySelectorAll("g.edgeLabel").forEach((labelEl) => {
    const text = labelEl.textContent?.trim();
    const bbox = labelEl.getBoundingClientRect();
    if (text) {
      edgeLabels[labelEl.id] = {
        text,
        x: bbox.left + bbox.width / 2,
        y: bbox.top + bbox.height / 2,
      };
    }
  });

  svgElement.querySelectorAll("path.flowchart-link").forEach((path) => {
    const pathId = path.id;
    if (!pathId) return;

    let sourceNode = null;
    let targetNode = null;
    let idParts = pathId.replace(/^(L_|FL_)/, "").split("_");
    if (idParts.length > 1 && idParts[idParts.length - 1].match(/^\d+$/)) {
      idParts.pop();
    }
    idParts = idParts.join("_");

    for (let i = 1; i < idParts.length; i++) {
      const potentialSourceName = idParts.substring(0, i);
      const potentialTargetName = idParts.substring(i);
      const foundSourceNode = Object.values(nodes).find(
        (n) => n.mermaidId === potentialSourceName
      );
      const foundTargetNode = Object.values(nodes).find(
        (n) => n.mermaidId === potentialTargetName
      );
      if (foundSourceNode && foundTargetNode) {
        sourceNode = foundSourceNode;
        targetNode = foundTargetNode;
        break;
      }
    }

    if (!sourceNode || !targetNode) {
      const pathIdParts = pathId.replace(/^(L_|FL_)/, "").split("_");
      if (pathIdParts.length > 2) {
        for (let i = 1; i < pathIdParts.length; i++) {
          const sName = pathIdParts.slice(0, i).join("_");
          const tName = pathIdParts.slice(i, pathIdParts.length - 1).join("_");
          const foundSourceNode = Object.values(nodes).find(
            (n) => n.mermaidId === sName
          );
          const foundTargetNode = Object.values(nodes).find(
            (n) => n.mermaidId === tName
          );
          if (foundSourceNode && foundTargetNode) {
            sourceNode = foundSourceNode;
            targetNode = foundTargetNode;
            break;
          }
        }
      }
    }

    if (!sourceNode || !targetNode) {
      console.warn("Could not determine source/target for edge:", pathId);
      return;
    }

    let label = "";
    try {
      const totalLength = path.getTotalLength();
      if (totalLength > 0) {
        const midPoint = path.getPointAtLength(totalLength / 2);
        let closestLabel = null;
        let closestDist = Infinity;
        for (const labelId in edgeLabels) {
          const currentLabel = edgeLabels[labelId];
          const dist = Math.sqrt(
            Math.pow(currentLabel.x - midPoint.x, 2) +
              Math.pow(currentLabel.y - midPoint.y, 2)
          );
          if (dist < closestDist) {
            closestDist = dist;
            closestLabel = currentLabel;
          }
        }
        if (closestLabel && closestDist < 75) {
          label = closestLabel.text;
        }
      }
    } catch (e) {
      console.error("Error matching label for edge " + pathId, e);
    }

    const labelPart = label ? `|"${label}"|` : "";
    const edgeText = `${sourceNode.mermaidId} -->${labelPart} ${targetNode.mermaidId}`;

    const sourceAncestors = [parentMap[sourceNode.svgId]];
    while (sourceAncestors[sourceAncestors.length - 1]) {
      sourceAncestors.push(
        parentMap[sourceAncestors[sourceAncestors.length - 1]]
      );
    }
    let lca = parentMap[targetNode.svgId];
    while (lca && !sourceAncestors.includes(lca)) {
      lca = parentMap[lca];
    }

    edges.push({ text: edgeText, parentId: lca || "root" });
  });

  const definedNodeMermaidIds = new Set();
  for (const svgId in nodes) {
    const node = nodes[svgId];
    if (!definedNodeMermaidIds.has(node.mermaidId)) {
      mermaidCode += `${node.mermaidId}["${node.text}"]\n`;
      definedNodeMermaidIds.add(node.mermaidId);
    }
  }
  mermaidCode += "\n";

  const childrenMap = {};
  const edgeMap = {};

  for (const childId in parentMap) {
    const parentId = parentMap[childId];
    if (!childrenMap[parentId]) childrenMap[parentId] = [];
    childrenMap[parentId].push(childId);
  }

  edges.forEach((edge) => {
    const parentId = edge.parentId || "root";
    if (!edgeMap[parentId]) edgeMap[parentId] = [];
    edgeMap[parentId].push(edge.text);
  });

  (edgeMap["root"] || []).forEach((edgeText) => {
    mermaidCode += `${edgeText}\n`;
  });

  function buildSubgraphOutput(clusterId) {
    const cluster = clusters[clusterId];
    if (!cluster) return;

    mermaidCode += `\nsubgraph ${cluster.mermaidId} ["${cluster.title}"]\n`;

    const childItems = childrenMap[clusterId] || [];

    childItems
      .filter((id) => nodes[id])
      .forEach((nodeId) => {
        mermaidCode += `    ${nodes[nodeId].mermaidId}\n`;
      });

    (edgeMap[clusterId] || []).forEach((edgeText) => {
      mermaidCode += `    ${edgeText}\n`;
    });

    childItems
      .filter((id) => clusters[id])
      .forEach((subClusterId) => {
        buildSubgraphOutput(subClusterId);
      });

    mermaidCode += "end\n";
  }

  const topLevelClusters = Object.keys(clusters).filter((id) => !parentMap[id]);
  topLevelClusters.forEach(buildSubgraphOutput);

  if (Object.keys(nodes).length === 0 && Object.keys(clusters).length === 0)
    return null;
  return "```mermaid\n" + mermaidCode.trim() + "\n```";
}
