// Function for Class Diagram (ensure this exists from previous responses)
function convertClassDiagramSvgToMermaidText(svgElement) {
  if (!svgElement) return null;
  const mermaidLines = ["classDiagram"];
  const classData = {};

  // 1. Parse Classes and their geometric information
  svgElement
    .querySelectorAll('g.node.default[id^="classId-"]')
    .forEach((node) => {
      const classIdSvg = node.getAttribute("id");
      if (!classIdSvg) return;

      const classNameMatch = classIdSvg.match(
        /^classId-([^-]+(?:-[^-]+)*)-(\d+)$/
      );
      if (!classNameMatch) return;
      const className = classNameMatch[1];

      let cx = 0,
        cy = 0,
        halfWidth = 0,
        halfHeight = 0;
      const transform = node.getAttribute("transform");
      if (transform) {
        const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
        if (match) {
          cx = parseFloat(match[1]);
          cy = parseFloat(match[2]);
        }
      }
      const pathForBounds = node.querySelector(
        'g.basic.label-container > path[d^="M-"]'
      );
      if (pathForBounds) {
        const d = pathForBounds.getAttribute("d");
        const dMatch = d.match(/M-([0-9.]+)\s+-([0-9.]+)/); // Extracts W and H from M-W -H
        if (dMatch && dMatch.length >= 3) {
          halfWidth = parseFloat(dMatch[1]);
          halfHeight = parseFloat(dMatch[2]);
        }
      }

      if (!classData[className]) {
        classData[className] = {
          stereotype: "",
          members: [],
          methods: [],
          svgId: classIdSvg,
          x: cx,
          y: cy,
          width: halfWidth * 2,
          height: halfHeight * 2,
        };
      }
      const stereotypeElem = node.querySelector(
        "g.annotation-group.text foreignObject span.nodeLabel p, g.annotation-group.text foreignObject div p"
      );
      if (stereotypeElem && stereotypeElem.textContent.trim()) {
        classData[className].stereotype = stereotypeElem.textContent.trim();
      }
      node
        .querySelectorAll(
          "g.members-group.text g.label foreignObject span.nodeLabel p, g.members-group.text g.label foreignObject div p"
        )
        .forEach((m) => {
          const txt = m.textContent.trim();
          if (txt) classData[className].members.push(txt);
        });
      node
        .querySelectorAll(
          "g.methods-group.text g.label foreignObject span.nodeLabel p, g.methods-group.text g.label foreignObject div p"
        )
        .forEach((m) => {
          const txt = m.textContent.trim();
          if (txt) classData[className].methods.push(txt);
        });
    });

  // 2. Parse Notes
  const notes = [];

  // Method 1: Find traditional rect.note and text.noteText
  svgElement.querySelectorAll("g").forEach((g) => {
    const noteRect = g.querySelector("rect.note");
    const noteText = g.querySelector("text.noteText");

    if (noteRect && noteText) {
      const text = noteText.textContent.trim();
      const x = parseFloat(noteRect.getAttribute("x"));
      const y = parseFloat(noteRect.getAttribute("y"));
      const width = parseFloat(noteRect.getAttribute("width"));
      const height = parseFloat(noteRect.getAttribute("height"));

      if (text && !isNaN(x) && !isNaN(y)) {
        notes.push({
          text: text,
          x: x,
          y: y,
          width: width || 0,
          height: height || 0,
          id: g.id || `note_${notes.length}`,
        });
      }
    }
  });

  // Method 2: Find other note formats (like node undefined type)
  svgElement
    .querySelectorAll('g.node.undefined, g[id^="note"]')
    .forEach((g) => {
      // Check if it's a note (by background color, id or other features)
      const hasNoteBackground = g.querySelector(
        'path[fill="#fff5ad"], path[style*="#fff5ad"], path[style*="fill:#fff5ad"]'
      );
      const isNoteId = g.id && g.id.includes("note");

      if (hasNoteBackground || isNoteId) {
        // Try to get text from foreignObject
        let text = "";
        const foreignObject = g.querySelector("foreignObject");
        if (foreignObject) {
          const textEl = foreignObject.querySelector(
            "p, span.nodeLabel, .nodeLabel"
          );
          if (textEl) {
            text = textEl.textContent.trim();
          }
        }

        // If no text found, try other selectors
        if (!text) {
          const textEl = g.querySelector("text, .label text, tspan");
          if (textEl) {
            text = textEl.textContent.trim();
          }
        }

        if (text) {
          // Get position information
          const transform = g.getAttribute("transform");
          let x = 0,
            y = 0;
          if (transform) {
            const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
            if (match) {
              x = parseFloat(match[1]);
              y = parseFloat(match[2]);
            }
          }

          // Check if this note has already been added
          const existingNote = notes.find(
            (n) =>
              n.text === text &&
              Math.abs(n.x - x) < 10 &&
              Math.abs(n.y - y) < 10
          );
          if (!existingNote) {
            notes.push({
              text: text,
              x: x,
              y: y,
              width: 0,
              height: 0,
              id: g.id || `note_${notes.length}`,
            });
          }
        }
      }
    });

  // 3. Parse Note-to-Class Connections
  const noteTargets = {}; // Maps note.id to target className
  const connectionThreshold = 50; // Increase connection threshold

  // Find note connection paths, support multiple path types
  const noteConnections = [
    ...svgElement.querySelectorAll("path.relation.edge-pattern-dotted"),
    ...svgElement.querySelectorAll('path[id^="edgeNote"]'),
    ...svgElement.querySelectorAll(
      "path.edge-thickness-normal.edge-pattern-dotted"
    ),
  ];

  noteConnections.forEach((pathEl) => {
    const dAttr = pathEl.getAttribute("d");
    if (!dAttr) return;

    // Improved path parsing, support Bezier curves
    const pathPoints = [];

    // Parse various path commands
    const commands = dAttr.match(/[A-Za-z][^A-Za-z]*/g) || [];
    let currentX = 0,
      currentY = 0;

    commands.forEach((cmd) => {
      const parts = cmd.match(/[A-Za-z]|[-+]?\d*\.?\d+/g) || [];
      const type = parts[0];
      const coords = parts.slice(1).map(Number);

      switch (type.toUpperCase()) {
        case "M": // Move to
          if (coords.length >= 2) {
            currentX = coords[0];
            currentY = coords[1];
            pathPoints.push({ x: currentX, y: currentY });
          }
          break;
        case "L": // Line to
          for (let i = 0; i < coords.length; i += 2) {
            if (coords[i + 1] !== undefined) {
              currentX = coords[i];
              currentY = coords[i + 1];
              pathPoints.push({ x: currentX, y: currentY });
            }
          }
          break;
        case "C": // Cubic bezier
          for (let i = 0; i < coords.length; i += 6) {
            if (coords[i + 5] !== undefined) {
              // Get end point coordinates
              currentX = coords[i + 4];
              currentY = coords[i + 5];
              pathPoints.push({ x: currentX, y: currentY });
            }
          }
          break;
        case "Q": // Quadratic bezier
          for (let i = 0; i < coords.length; i += 4) {
            if (coords[i + 3] !== undefined) {
              currentX = coords[i + 2];
              currentY = coords[i + 3];
              pathPoints.push({ x: currentX, y: currentY });
            }
          }
          break;
      }
    });

    if (pathPoints.length < 2) return;

    const pathStart = pathPoints[0];
    const pathEnd = pathPoints[pathPoints.length - 1];

    // Find the closest note to path start point
    let closestNote = null;
    let minDistToNote = Infinity;
    notes.forEach((note) => {
      const dist = Math.sqrt(
        Math.pow(note.x - pathStart.x, 2) + Math.pow(note.y - pathStart.y, 2)
      );
      if (dist < minDistToNote) {
        minDistToNote = dist;
        closestNote = note;
      }
    });

    // Find the closest class to path end point
    let targetClassName = null;
    let minDistToClass = Infinity;
    for (const currentClassName in classData) {
      const classInfo = classData[currentClassName];
      const classCenterX = classInfo.x;
      const classCenterY = classInfo.y;
      const classWidth = classInfo.width || 200; // Default width
      const classHeight = classInfo.height || 200; // Default height

      // Calculate distance from path end to class center
      const distToCenter = Math.sqrt(
        Math.pow(pathEnd.x - classCenterX, 2) +
          Math.pow(pathEnd.y - classCenterY, 2)
      );

      // Also calculate distance to class boundary
      const classLeft = classCenterX - classWidth / 2;
      const classRight = classCenterX + classWidth / 2;
      const classTop = classCenterY - classHeight / 2;
      const classBottom = classCenterY + classHeight / 2;

      const dx = Math.max(classLeft - pathEnd.x, 0, pathEnd.x - classRight);
      const dy = Math.max(classTop - pathEnd.y, 0, pathEnd.y - classBottom);
      const distToEdge = Math.sqrt(dx * dx + dy * dy);

      // Use the smaller distance as the judgment criterion
      const finalDist = Math.min(distToCenter, distToEdge + classWidth / 4);

      if (finalDist < minDistToClass) {
        minDistToClass = finalDist;
        targetClassName = currentClassName;
      }
    }

    // Relax connection conditions
    if (
      closestNote &&
      targetClassName &&
      minDistToNote < connectionThreshold &&
      minDistToClass < connectionThreshold * 2
    ) {
      const existing = noteTargets[closestNote.id];
      const currentScore = minDistToNote + minDistToClass;

      if (!existing || currentScore < existing.score) {
        noteTargets[closestNote.id] = {
          name: targetClassName,
          score: currentScore,
          noteDistance: minDistToNote,
          classDistance: minDistToClass,
        };
      }
    }
  });

  // 4. Add Note Definitions to Mermaid output
  const noteMermaidLines = [];
  notes.forEach((note) => {
    const targetInfo = noteTargets[note.id];
    if (targetInfo && targetInfo.name) {
      noteMermaidLines.push(`    note for ${targetInfo.name} "${note.text}"`);
    } else {
      noteMermaidLines.push(`    note "${note.text}"`);
    }
  });
  // Insert notes after 'classDiagram' line
  if (noteMermaidLines.length > 0) {
    mermaidLines.splice(1, 0, ...noteMermaidLines);
  }

  // 5. Add Class Definitions
  for (const className in classData) {
    const data = classData[className];
    if (data.stereotype) {
      mermaidLines.push(`    class ${className} {`);
      mermaidLines.push(`        ${data.stereotype}`);
    } else {
      mermaidLines.push(`    class ${className} {`);
    }
    data.members.forEach((member) => {
      mermaidLines.push(`        ${member}`);
    });
    data.methods.forEach((method) => {
      mermaidLines.push(`        ${method}`);
    });
    mermaidLines.push("    }");
  }

  const pathElements = Array.from(
    svgElement.querySelectorAll('path.relation[id^="id_"]')
  );
  const labelElements = Array.from(
    svgElement.querySelectorAll("g.edgeLabels .edgeLabel foreignObject p")
  );

  pathElements.forEach((path, index) => {
    const id = path.getAttribute("id");
    if (!id || !id.startsWith("id_")) return;

    // Remove 'id_' prefix and trailing number (e.g., '_1')
    let namePart = id.substring(3).replace(/_\d+$/, "");

    const idParts = namePart.split("_");
    let fromClass = null;
    let toClass = null;

    // Iterate through possible split points to find valid class names
    for (let i = 1; i < idParts.length; i++) {
      const potentialFrom = idParts.slice(0, i).join("_");
      const potentialTo = idParts.slice(i).join("_");

      if (classData[potentialFrom] && classData[potentialTo]) {
        fromClass = potentialFrom;
        toClass = potentialTo;
        break; // Found a valid pair
      }
    }

    if (!fromClass || !toClass) {
      console.error("Could not parse class relation from ID:", id);
      return; // Skip if we couldn't parse
    }

    // Get key attributes
    const markerEndAttr = path.getAttribute("marker-end") || "";
    const markerStartAttr = path.getAttribute("marker-start") || "";
    const pathClass = path.getAttribute("class") || "";

    // Determine line style: solid or dashed
    const isDashed =
      path.classList.contains("dashed-line") ||
      path.classList.contains("dotted-line") ||
      pathClass.includes("dashed") ||
      pathClass.includes("dotted");
    const lineStyle = isDashed ? ".." : "--";

    let relationshipType = "";

    // Inheritance relation: <|-- or --|> (corrected inheritance relationship judgment)
    if (markerStartAttr.includes("extensionStart")) {
      // marker-start has extension, arrow at start point, means: toClass inherits fromClass
      if (isDashed) {
        // Dashed inheritance (implementation relationship): fromClass <|.. toClass
        relationshipType = `${fromClass} <|.. ${toClass}`;
      } else {
        // Solid inheritance: fromClass <|-- toClass
        relationshipType = `${fromClass} <|${lineStyle} ${toClass}`;
      }
    } else if (markerEndAttr.includes("extensionEnd")) {
      // marker-end has extension, arrow at end point, means: fromClass inherits toClass
      if (isDashed) {
        // Dashed inheritance (implementation relationship): toClass <|.. fromClass
        relationshipType = `${toClass} <|.. ${fromClass}`;
      } else {
        // Solid inheritance: toClass <|-- fromClass
        relationshipType = `${toClass} <|${lineStyle} ${fromClass}`;
      }
    }
    // Implementation relation: ..|> (corrected implementation relationship judgment)
    else if (
      markerStartAttr.includes("lollipopStart") ||
      markerStartAttr.includes("implementStart")
    ) {
      relationshipType = `${toClass} ..|> ${fromClass}`;
    } else if (
      markerEndAttr.includes("implementEnd") ||
      markerEndAttr.includes("lollipopEnd") ||
      (markerEndAttr.includes("interfaceEnd") && isDashed)
    ) {
      relationshipType = `${fromClass} ..|> ${toClass}`;
    }
    // Composition relation: *-- (corrected composition relationship judgment)
    else if (markerStartAttr.includes("compositionStart")) {
      // marker-start has composition, diamond at start point, means: fromClass *-- toClass
      relationshipType = `${fromClass} *${lineStyle} ${toClass}`;
    } else if (
      markerEndAttr.includes("compositionEnd") ||
      (markerEndAttr.includes("diamondEnd") && markerEndAttr.includes("filled"))
    ) {
      relationshipType = `${toClass} *${lineStyle} ${fromClass}`;
    }
    // Aggregation relation: o-- (corrected aggregation relationship judgment)
    else if (markerStartAttr.includes("aggregationStart")) {
      // marker-start has aggregation, empty diamond at start point, means: toClass --o fromClass
      relationshipType = `${toClass} ${lineStyle}o ${fromClass}`;
    } else if (
      markerEndAttr.includes("aggregationEnd") ||
      (markerEndAttr.includes("diamondEnd") &&
        !markerEndAttr.includes("filled"))
    ) {
      relationshipType = `${fromClass} o${lineStyle} ${toClass}`;
    }
    // Dependency relation: ..> or --> (corrected dependency relationship judgment)
    else if (markerStartAttr.includes("dependencyStart")) {
      if (isDashed) {
        relationshipType = `${toClass} <.. ${fromClass}`;
      } else {
        relationshipType = `${toClass} <-- ${fromClass}`;
      }
    } else if (markerEndAttr.includes("dependencyEnd")) {
      if (isDashed) {
        relationshipType = `${fromClass} ..> ${toClass}`;
      } else {
        relationshipType = `${fromClass} --> ${toClass}`;
      }
    }
    // Association relation: --> (corrected association relationship judgment)
    else if (
      markerStartAttr.includes("arrowStart") ||
      markerStartAttr.includes("openStart")
    ) {
      relationshipType = `${toClass} <${lineStyle} ${fromClass}`;
    } else if (
      markerEndAttr.includes("arrowEnd") ||
      markerEndAttr.includes("openEnd")
    ) {
      relationshipType = `${fromClass} ${lineStyle}> ${toClass}`;
    }
    // Arrowless solid line link: --
    else if (
      lineStyle === "--" &&
      !markerEndAttr.includes("End") &&
      !markerStartAttr.includes("Start")
    ) {
      relationshipType = `${fromClass} -- ${toClass}`;
    }
    // Arrowless dashed line link: ..
    else if (
      lineStyle === ".." &&
      !markerEndAttr.includes("End") &&
      !markerStartAttr.includes("Start")
    ) {
      relationshipType = `${fromClass} .. ${toClass}`;
    }
    // Default relation
    else {
      relationshipType = `${fromClass} ${lineStyle} ${toClass}`;
    }

    // Get relationship label text
    const labelText =
      labelElements[index] && labelElements[index].textContent
        ? labelElements[index].textContent.trim()
        : "";

    if (relationshipType) {
      mermaidLines.push(
        `    ${relationshipType}${labelText ? " : " + labelText : ""}`
      );
    }
  });

  if (
    mermaidLines.length <= 1 &&
    Object.keys(classData).length === 0 &&
    notes.length === 0
  )
    return null;
  return "```mermaid\n" + mermaidLines.join("\n") + "\n```";
}

/**
 * Helper: Convert SVG Sequence Diagram to Mermaid code
 * @param {SVGElement} svgElement - The SVG DOM element for the sequence diagram
 * @returns {string|null}
 */
function convertSequenceDiagramSvgToMermaidText(svgElement) {
  if (!svgElement) return null;

  // 1. Parse participants
  const participants = [];
  console.log("Looking for sequence participants..."); // DEBUG

  // Find all participant text elements
  svgElement.querySelectorAll("text.actor-box").forEach((textEl) => {
    const name = textEl.textContent.trim().replace(/^"|"$/g, ""); // Remove quotes
    const x = parseFloat(textEl.getAttribute("x"));
    console.log("Found participant:", name, "at x:", x); // DEBUG
    if (name && !isNaN(x)) {
      participants.push({ name, x });
    }
  });

  console.log("Total participants found:", participants.length); // DEBUG
  participants.sort((a, b) => a.x - b.x);

  // Remove duplicate participants
  const uniqueParticipants = [];
  const seenNames = new Set();
  participants.forEach((p) => {
    if (!seenNames.has(p.name)) {
      uniqueParticipants.push(p);
      seenNames.add(p.name);
    }
  });

  // 2. Parse Notes
  const notes = [];
  svgElement.querySelectorAll("g").forEach((g) => {
    const noteRect = g.querySelector("rect.note");
    const noteText = g.querySelector("text.noteText");

    if (noteRect && noteText) {
      const text = noteText.textContent.trim();
      const x = parseFloat(noteRect.getAttribute("x"));
      const width = parseFloat(noteRect.getAttribute("width"));
      const leftX = x;
      const rightX = x + width;

      // Find all participants within note coverage range
      const coveredParticipants = [];
      uniqueParticipants.forEach((p) => {
        // Check if participant is within note's horizontal range
        if (p.x >= leftX && p.x <= rightX) {
          coveredParticipants.push(p);
        }
      });

      // Sort by x coordinate
      coveredParticipants.sort((a, b) => a.x - b.x);

      if (coveredParticipants.length > 0) {
        let noteTarget;
        if (coveredParticipants.length === 1) {
          // Single participant
          noteTarget = coveredParticipants[0].name;
        } else {
          // Multiple participants, use first and last
          const firstParticipant = coveredParticipants[0].name;
          const lastParticipant =
            coveredParticipants[coveredParticipants.length - 1].name;
          noteTarget = `${firstParticipant},${lastParticipant}`;
        }

        notes.push({
          text: text,
          target: noteTarget,
          y: parseFloat(noteRect.getAttribute("y")),
        });
      }
    }
  });

  // 3. Parse message lines and message text
  const messages = [];

  // Collect all message texts
  const messageTexts = [];
  svgElement.querySelectorAll("text.messageText").forEach((textEl) => {
    const text = textEl.textContent.trim();
    const y = parseFloat(textEl.getAttribute("y"));
    const x = parseFloat(textEl.getAttribute("x"));
    if (text && !isNaN(y)) {
      messageTexts.push({ text, y, x });
    }
  });
  messageTexts.sort((a, b) => a.y - b.y);
  console.log("Found message texts:", messageTexts.length); // DEBUG

  // Collect all message lines
  const messageLines = [];
  svgElement
    .querySelectorAll("line.messageLine0, line.messageLine1")
    .forEach((lineEl) => {
      const x1 = parseFloat(lineEl.getAttribute("x1"));
      const y1 = parseFloat(lineEl.getAttribute("y1"));
      const x2 = parseFloat(lineEl.getAttribute("x2"));
      const y2 = parseFloat(lineEl.getAttribute("y2"));
      const isDashed = lineEl.classList.contains("messageLine1");

      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
        messageLines.push({ x1, y1, x2, y2, isDashed });
      }
    });

  // Collect all curved message paths (self messages)
  svgElement
    .querySelectorAll("path.messageLine0, path.messageLine1")
    .forEach((pathEl) => {
      const d = pathEl.getAttribute("d");
      const isDashed = pathEl.classList.contains("messageLine1");

      if (d) {
        // Parse path, check if it's a self message
        const moveMatch = d.match(/M\s*([^,\s]+)[,\s]+([^,\s]+)/);
        const endMatch = d.match(/([^,\s]+)[,\s]+([^,\s]+)$/);

        if (moveMatch && endMatch) {
          const x1 = parseFloat(moveMatch[1]);
          const y1 = parseFloat(moveMatch[2]);
          const x2 = parseFloat(endMatch[1]);
          const y2 = parseFloat(endMatch[2]);

          // Check if it's a self message (start and end x coordinates are close)
          if (Math.abs(x1 - x2) < 20) {
            // Allow some margin of error
            messageLines.push({
              x1,
              y1,
              x2,
              y2,
              isDashed,
              isSelfMessage: true,
            });
          }
        }
      }
    });

  messageLines.sort((a, b) => a.y1 - b.y1);
  console.log("Found message lines:", messageLines.length); // DEBUG

  // 4. Match message lines and message text
  for (let i = 0; i < Math.min(messageLines.length, messageTexts.length); i++) {
    const line = messageLines[i];
    const messageText = messageTexts[i];

    let fromParticipant = null;
    let toParticipant = null;

    if (line.isSelfMessage) {
      // Self message - find participant closest to x1
      let minDist = Infinity;
      for (const p of uniqueParticipants) {
        const dist = Math.abs(p.x - line.x1);
        if (dist < minDist) {
          minDist = dist;
          fromParticipant = toParticipant = p.name;
        }
      }
    } else {
      // Find sender and receiver based on x coordinates
      let minDist1 = Infinity;
      for (const p of uniqueParticipants) {
        const dist = Math.abs(p.x - line.x1);
        if (dist < minDist1) {
          minDist1 = dist;
          fromParticipant = p.name;
        }
      }

      let minDist2 = Infinity;
      for (const p of uniqueParticipants) {
        const dist = Math.abs(p.x - line.x2);
        if (dist < minDist2) {
          minDist2 = dist;
          toParticipant = p.name;
        }
      }
    }

    if (fromParticipant && toParticipant) {
      // Determine arrow type
      let arrow;
      if (line.isDashed) {
        arrow = "-->>"; // Dashed arrow
      } else {
        arrow = "->>"; // Solid arrow
      }

      messages.push({
        from: fromParticipant,
        to: toParticipant,
        text: messageText.text,
        arrow: arrow,
        y: line.y1,
        isSelfMessage: line.isSelfMessage || false,
      });

      console.log(
        `Message ${i + 1}: ${fromParticipant} ${arrow} ${toParticipant}: ${
          messageText.text
        }`
      ); // DEBUG
    }
  }

  // 5. Parse loop areas
  const loops = [];
  const loopLines = svgElement.querySelectorAll("line.loopLine");
  if (loopLines.length >= 4) {
    const xs = Array.from(loopLines)
      .map((line) => [
        parseFloat(line.getAttribute("x1")),
        parseFloat(line.getAttribute("x2")),
      ])
      .flat();
    const ys = Array.from(loopLines)
      .map((line) => [
        parseFloat(line.getAttribute("y1")),
        parseFloat(line.getAttribute("y2")),
      ])
      .flat();

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    let loopText = "";
    const loopTextEl = svgElement.querySelector(".loopText");
    if (loopTextEl) {
      loopText = loopTextEl.textContent.trim();
    }

    loops.push({ xMin, xMax, yMin, yMax, text: loopText });
    console.log("Found loop:", loopText, "from y", yMin, "to", yMax); // DEBUG
  }

  // 6. Generate Mermaid code
  let mermaidOutput = "sequenceDiagram\n";

  // Add participants
  uniqueParticipants.forEach((p) => {
    mermaidOutput += `  participant ${p.name}\n`;
  });
  mermaidOutput += "\n";

  // Sort all events by y coordinate (messages, notes, loops)
  const events = [];

  messages.forEach((msg) => {
    events.push({ type: "message", y: msg.y, data: msg });
  });

  notes.forEach((note) => {
    events.push({ type: "note", y: note.y, data: note });
  });

  loops.forEach((loop) => {
    events.push({ type: "loop_start", y: loop.yMin - 1, data: loop });
    events.push({ type: "loop_end", y: loop.yMax + 1, data: loop });
  });

  events.sort((a, b) => a.y - b.y);

  // Generate events
  let loopStack = [];
  events.forEach((event) => {
    if (event.type === "loop_start") {
      const text = event.data.text ? ` ${event.data.text}` : "";
      mermaidOutput += `  loop${text}\n`;
      loopStack.push(event.data);
    } else if (event.type === "loop_end") {
      if (loopStack.length > 0) {
        mermaidOutput += `  end\n`;
        loopStack.pop();
      }
    } else if (event.type === "note") {
      const indent = loopStack.length > 0 ? "  " : "";
      mermaidOutput += `${indent}  note over ${event.data.target}: ${event.data.text}\n`;
    } else if (event.type === "message") {
      const indent = loopStack.length > 0 ? "  " : "";
      const msg = event.data;
      mermaidOutput += `${indent}  ${msg.from}${msg.arrow}${msg.to}: ${msg.text}\n`;
    }
  });

  // Close remaining loops
  while (loopStack.length > 0) {
    mermaidOutput += `  end\n`;
    loopStack.pop();
  }

  if (uniqueParticipants.length === 0 && messages.length === 0) return null;
  console.log(
    "Sequence diagram conversion completed. Participants:",
    uniqueParticipants.length,
    "Messages:",
    messages.length,
    "Notes:",
    notes.length
  ); // DEBUG
  console.log(
    "Generated sequence mermaid code:",
    mermaidOutput.substring(0, 200) + "..."
  ); // DEBUG
  return "```mermaid\n" + mermaidOutput.trim() + "\n```";
}

/**
 * Helper: Convert SVG State Diagram to Mermaid code
 * @param {SVGElement} svgElement - The SVG DOM element for the state diagram
 * @returns {string|null}
 */
function convertStateDiagramSvgToMermaidText(svgElement) {
  if (!svgElement) return null;

  console.log("Converting state diagram...");

  const nodes = [];

  // 1. Parse all states
  svgElement
    .querySelectorAll("g.node.statediagram-state")
    .forEach((stateEl) => {
      const stateName = stateEl
        .querySelector(
          "foreignObject .nodeLabel p, foreignObject .nodeLabel span"
        )
        ?.textContent.trim();
      if (!stateName) return;

      const transform = stateEl.getAttribute("transform");
      const rect = stateEl.querySelector("rect.basic.label-container");
      if (!transform || !rect) return;

      const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (!transformMatch) return;

      const tx = parseFloat(transformMatch[1]);
      const ty = parseFloat(transformMatch[2]);
      const rx = parseFloat(rect.getAttribute("x"));
      const ry = parseFloat(rect.getAttribute("y"));
      const width = parseFloat(rect.getAttribute("width"));
      const height = parseFloat(rect.getAttribute("height"));

      nodes.push({
        name: stateName,
        x1: tx + rx,
        y1: ty + ry,
        x2: tx + rx + width,
        y2: ty + ry + height,
      });
      console.log(`Found State: ${stateName}`, nodes[nodes.length - 1]);
    });

  // 2. Find start state
  const startStateEl = svgElement.querySelector(
    "g.node.default circle.state-start"
  );
  if (startStateEl) {
    const startGroup = startStateEl.closest("g.node");
    const transform = startGroup.getAttribute("transform");
    const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
    const r = parseFloat(startStateEl.getAttribute("r"));
    if (transformMatch && r) {
      const tx = parseFloat(transformMatch[1]);
      const ty = parseFloat(transformMatch[2]);
      nodes.push({
        name: "[*]",
        x1: tx - r,
        y1: ty - r,
        x2: tx + r,
        y2: ty + r,
        isSpecial: true,
      });
      console.log("Found Start State", nodes[nodes.length - 1]);
    }
  }

  // 3. Find end state
  svgElement.querySelectorAll("g.node.default").forEach((endGroup) => {
    if (endGroup.querySelectorAll("path").length >= 2) {
      const transform = endGroup.getAttribute("transform");
      if (transform) {
        const transformMatch = transform.match(
          /translate\(([^,]+),\s*([^)]+)\)/
        );
        if (transformMatch) {
          const tx = parseFloat(transformMatch[1]);
          const ty = parseFloat(transformMatch[2]);
          const r = 7; // Mermaid end circle radius is 7
          nodes.push({
            name: "[*]",
            x1: tx - r,
            y1: ty - r,
            x2: tx + r,
            y2: ty + r,
            isSpecial: true,
          });
          console.log("Found End State", nodes[nodes.length - 1]);
        }
      }
    }
  });

  // 4. Get all labels
  const labels = [];
  svgElement.querySelectorAll("g.edgeLabel").forEach((labelEl) => {
    const text = labelEl
      .querySelector(
        "foreignObject .edgeLabel p, foreignObject .edgeLabel span"
      )
      ?.textContent.trim()
      .replace(/^"|"$/g, "");
    const transform = labelEl.getAttribute("transform");
    if (text && transform) {
      const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (match) {
        labels.push({
          text: text,
          x: parseFloat(match[1]),
          y: parseFloat(match[2]),
        });
      }
    }
  });

  function getDistanceToBox(px, py, box) {
    const dx = Math.max(box.x1 - px, 0, px - box.x2);
    const dy = Math.max(box.y1 - py, 0, py - box.y2);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getDistance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
  }

  const transitions = [];

  // 5. Process paths
  svgElement.querySelectorAll("path.transition").forEach((pathEl) => {
    const dAttr = pathEl.getAttribute("d");
    if (!dAttr) return;

    const startMatch = dAttr.match(/M\s*([^,\s]+)[,\s]+([^,\s]+)/);
    // More robustly find the last coordinate pair in the d string
    const pathSegments = dAttr.split(/[A-Za-z]/);
    const lastSegment = pathSegments[pathSegments.length - 1].trim();
    const endCoords = lastSegment.split(/[\s,]+/).map(parseFloat);

    if (!startMatch || endCoords.length < 2) return;

    const startX = parseFloat(startMatch[1]);
    const startY = parseFloat(startMatch[2]);
    const endX = endCoords[endCoords.length - 2];
    const endY = endCoords[endCoords.length - 1];

    let sourceNode = null,
      targetNode = null;
    let minSourceDist = Infinity,
      minTargetDist = Infinity;

    nodes.forEach((node) => {
      const distToStart = getDistanceToBox(startX, startY, node);
      if (distToStart < minSourceDist) {
        minSourceDist = distToStart;
        sourceNode = node;
      }
      const distToEnd = getDistanceToBox(endX, endY, node);
      if (distToEnd < minTargetDist) {
        minTargetDist = distToEnd;
        targetNode = node;
      }
    });

    let transitionLabel = "";
    if (sourceNode && targetNode && minSourceDist < 5 && minTargetDist < 5) {
      // Find label
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      let closestLabel = null;
      let minLabelDist = Infinity;

      labels.forEach((label) => {
        const dist = getDistance(midX, midY, label.x, label.y);
        if (dist < minLabelDist) {
          minLabelDist = dist;
          closestLabel = label;
        }
      });

      if (closestLabel && minLabelDist < 150) {
        // Arbitrary threshold, seems to work
        transitionLabel = closestLabel.text;
      }

      if (sourceNode === targetNode) return; // Ignore self-loops for now

      const newTransition = {
        from: sourceNode.name,
        to: targetNode.name,
        label: transitionLabel,
      };

      // Avoid adding duplicates
      if (
        !transitions.some(
          (t) =>
            t.from === newTransition.from &&
            t.to === newTransition.to &&
            t.label === newTransition.label
        )
      ) {
        transitions.push(newTransition);
      }
    }
  });

  // 6. Generate Mermaid code
  let mermaidCode = "stateDiagram-v2\n";
  transitions.forEach((t) => {
    let line = `    ${t.from} --> ${t.to}`;
    if (t.label) {
      line += ` : "${t.label}"`;
    }
    mermaidCode += line + "\n";
  });

  if (transitions.length === 0) return null;

  console.log(
    "State diagram conversion completed. Transitions:",
    transitions.length
  );
  console.log("Generated state diagram mermaid code:", mermaidCode);

  return "```mermaid\n" + mermaidCode.trim() + "\n```";
}
// Helper function: recursively process nodes
function processNode(node) {
  // console.log("processNode START:", node.nodeName, node.nodeType, node.textContent ? node.textContent.substring(0,50) : ''); // DEBUG
  let resultMd = "";

  if (node.nodeType === Node.TEXT_NODE) {
    if (node.parentNode && node.parentNode.nodeName === "PRE") {
      return node.textContent;
    }
    // Fix: For normal text nodes, avoid consecutive blank lines being converted to a single newline,
    // then having \n\n added by outer logic causing too many empty lines
    // Simply return the text and let the parent block element handle the trailing \n\n
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node;
  const style = window.getComputedStyle(element);

  if (
    (style.display === "none" || style.visibility === "hidden") &&
    !["DETAILS", "SUMMARY"].includes(element.nodeName)
  ) {
    return "";
  }

  if (
    element.matches(
      'button, [role="button"], nav, footer, aside, script, style, noscript, iframe, embed, object, header'
    )
  ) {
    // Added header to general skip
    return "";
  }
  if (
    element.classList.contains("bg-input-dark") &&
    element.querySelector("svg")
  ) {
    // Your specific rule
    return "";
  }

  // Main logic wrapped in try...catch to catch errors when processing specific nodes
  try {
    switch (element.nodeName) {
      case "P": {
        let txt = "";
        element.childNodes.forEach((c) => {
          try {
            txt += processNode(c);
          } catch (e) {
            console.error("Error processing child of P:", c, e);
            txt += "[err]";
          }
        });
        txt = txt.trim();
        if (txt.startsWith("```mermaid") && txt.endsWith("```")) {
          // Already processed as Mermaid
          resultMd = txt + "\n\n";
        } else if (txt) {
          resultMd = txt + "\n\n";
        } else {
          resultMd = "\n"; // Keep empty P tag as a newline if needed
        }
        break;
      }
      case "H1":
        resultMd = element.textContent.trim()
          ? `# ${element.textContent.trim()}\n\n`
          : "";
        break;
      case "H2":
        resultMd = element.textContent.trim()
          ? `## ${element.textContent.trim()}\n\n`
          : "";
        break;
      case "H3":
        resultMd = element.textContent.trim()
          ? `### ${element.textContent.trim()}\n\n`
          : "";
        break;
      case "H4":
        resultMd = element.textContent.trim()
          ? `#### ${element.textContent.trim()}\n\n`
          : "";
        break;
      case "H5":
        resultMd = element.textContent.trim()
          ? `##### ${element.textContent.trim()}\n\n`
          : "";
        break;
      case "H6":
        resultMd = element.textContent.trim()
          ? `###### ${element.textContent.trim()}\n\n`
          : "";
        break;
      case "UL": {
        let list = "";
        // Determine if it is a source-related ul
        const isSourceList =
          (element.previousElementSibling &&
            /source/i.test(element.previousElementSibling.textContent)) ||
          (element.parentElement &&
            /source/i.test(element.parentElement.textContent)) ||
          element.classList.contains("source-list");
        element.querySelectorAll(":scope > li").forEach((li) => {
          let liTxt = "";
          li.childNodes.forEach((c) => {
            try {
              liTxt += processNode(c);
            } catch (e) {
              console.error("Error processing child of LI:", c, e);
              liTxt += "[err]";
            }
          });
          if (isSourceList) {
            liTxt = liTxt.trim().replace(/\n+/g, " "); // Merge source-related li into one line
          } else {
            liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
          }
          if (liTxt) list += `* ${liTxt}\n`;
        });
        resultMd = list + (list ? "\n" : "");
        break;
      }
      case "OL": {
        let list = "";
        let i = 1;
        // Determine if it is a source-related ol
        const isSourceList =
          (element.previousElementSibling &&
            /source/i.test(element.previousElementSibling.textContent)) ||
          (element.parentElement &&
            /source/i.test(element.parentElement.textContent)) ||
          element.classList.contains("source-list");
        element.querySelectorAll(":scope > li").forEach((li) => {
          let liTxt = "";
          li.childNodes.forEach((c) => {
            try {
              liTxt += processNode(c);
            } catch (e) {
              console.error("Error processing child of LI:", c, e);
              liTxt += "[err]";
            }
          });
          if (isSourceList) {
            liTxt = liTxt.trim().replace(/\n+/g, " ");
          } else {
            liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
          }
          if (liTxt) {
            list += `${i}. ${liTxt}\n`;
            i++;
          }
        });
        resultMd = list + (list ? "\n" : "");
        break;
      }
      case "PRE": {
        const svgElement = element.querySelector('svg[id^="mermaid-"]');
        let mermaidOutput = null;

        if (svgElement) {
          const diagramTypeDesc = svgElement.getAttribute(
            "aria-roledescription"
          );
          const diagramClass = svgElement.getAttribute("class");
          const datasetType = (
            svgElement.dataset?.diagramType ||
            svgElement.dataset?.graphType ||
            svgElement.dataset?.chartType ||
            svgElement.dataset?.mermaid
          )
            ?.toString()
            .toLowerCase();

          const combinedDescriptor = `${diagramTypeDesc || ""} ${
            diagramClass || ""
          } ${datasetType || ""}`.toLowerCase();

          console.log(
            "Found SVG in PRE: desc=",
            diagramTypeDesc,
            "class=",
            diagramClass
          ); // DEBUG
          if (diagramTypeDesc && diagramTypeDesc.includes("flowchart")) {
            console.log("Trying to convert flowchart..."); // DEBUG
            mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
          } else if (diagramTypeDesc && diagramTypeDesc.includes("class")) {
            console.log("Trying to convert class diagram..."); // DEBUG
            mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
          } else if (diagramTypeDesc && diagramTypeDesc.includes("sequence")) {
            console.log("Trying to convert sequence diagram..."); // DEBUG
            mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
          } else if (
            diagramTypeDesc &&
            diagramTypeDesc.includes("stateDiagram")
          ) {
            console.log("Trying to convert state diagram..."); // DEBUG
            mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
          } else if (diagramClass && diagramClass.includes("flowchart")) {
            console.log("Trying to convert flowchart by class..."); // DEBUG
            mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
          } else if (
            diagramClass &&
            (diagramClass.includes("classDiagram") ||
              diagramClass.includes("class"))
          ) {
            console.log("Trying to convert class diagram by class..."); // DEBUG
            mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
          } else if (
            diagramClass &&
            (diagramClass.includes("sequenceDiagram") ||
              diagramClass.includes("sequence"))
          ) {
            console.log("Trying to convert sequence diagram by class..."); // DEBUG
            mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
          } else if (
            diagramClass &&
            (diagramClass.includes("statediagram") ||
              diagramClass.includes("stateDiagram"))
          ) {
            console.log("Trying to convert state diagram by class..."); // DEBUG
            mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
          }

          if (!mermaidOutput && datasetType) {
            if (datasetType.includes("flow")) {
              mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
            } else if (datasetType.includes("class")) {
              mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
            } else if (datasetType.includes("sequence")) {
              mermaidOutput =
                convertSequenceDiagramSvgToMermaidText(svgElement);
            } else if (datasetType.includes("state")) {
              mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
            }
          }

          if (!mermaidOutput) {
            if (
              svgElement.querySelector(
                "line.messageLine0, line.messageLine1, path.messageLine0, path.messageLine1, text.actor-box, .actor"
              )
            ) {
              console.log("Heuristically treating as sequence diagram");
              mermaidOutput =
                convertSequenceDiagramSvgToMermaidText(svgElement);
            } else if (
              svgElement.querySelector(
                'g.node.default[id^="classId-"], g.classGroup'
              )
            ) {
              console.log("Heuristically treating as class diagram");
              mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
            } else if (
              svgElement.querySelector(
                "g.cluster, path.flowchart-link, .edgeLabel"
              )
            ) {
              console.log("Heuristically treating as flowchart diagram");
              mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
            } else if (
              svgElement.querySelector("g.transition, g.stateGroup") ||
              combinedDescriptor.includes("state")
            ) {
              console.log("Heuristically treating as state diagram");
              mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
            }
          }

          if (mermaidOutput) {
            console.log(
              "Successfully converted SVG to mermaid:",
              mermaidOutput.substring(0, 100) + "..."
            ); // DEBUG
          } else {
            console.log("Failed to convert SVG, using fallback"); // DEBUG
          }
        }

        if (!mermaidOutput) {
          const originalMermaidCode = element.querySelector(
            'code.language-mermaid, code.mermaid, code[data-lang="mermaid"]'
          );
          if (originalMermaidCode && originalMermaidCode.textContent.trim()) {
            mermaidOutput =
              "```mermaid\n" + originalMermaidCode.textContent.trim() + "\n```";
          }
        }

        if (mermaidOutput) {
          resultMd = `\n${mermaidOutput}\n\n`;
        } else {
          const code = element.querySelector("code");
          let lang = "";
          let txt = "";
          if (code) {
            txt = code.textContent;
            const cls = Array.from(code.classList).find((c) =>
              c.startsWith("language-")
            );
            if (cls) lang = cls.replace("language-", "");
          } else {
            txt = element.textContent;
          }
          if (!lang) {
            const preCls = Array.from(element.classList).find((c) =>
              c.startsWith("language-")
            );
            if (preCls) lang = preCls.replace("language-", "");
          }
          // Auto-detect language if still not found
          if (!lang && txt.trim()) {
            lang = detectCodeLanguage(txt);
          }
          resultMd = `\`\`\`${lang}\n${txt.trim()}\n\`\`\`\n\n`;
        }
        break;
      }
      case "A": {
        const href = element.getAttribute("href");
        let initialTextFromNodes = ""; // Collect raw text from children first
        element.childNodes.forEach((c) => {
          try {
            initialTextFromNodes += processNode(c);
          } catch (e) {
            console.error("Error processing child of A:", c, e);
            initialTextFromNodes += "[err]";
          }
        });
        let text = initialTextFromNodes.trim(); // This is the base text for further processing

        if (!text && element.querySelector("img")) {
          // Handle img alt text if link content is empty
          text = element.querySelector("img").alt || "image";
        }
        // `text` is now the initial display text, possibly from content or image alt.
        // `initialTextFromNodes` keeps the original structure for context like "Sources: [...]".

        if (
          href &&
          (href.startsWith("http") ||
            href.startsWith("https") ||
            href.startsWith("/") ||
            href.startsWith("#") ||
            href.startsWith("mailto:"))
        ) {
          let finalLinkDisplayText = text; // Start with the current text, may be overwritten by line logic

          const lineInfoMatch = href.match(/#L(\d+)(?:-L(\d+))?$/);

          if (lineInfoMatch) {
            const pathPart = href.substring(0, href.indexOf("#"));
            let filenameFromPath =
              pathPart.substring(pathPart.lastIndexOf("/") + 1) || "link"; // Default filename

            const startLine = lineInfoMatch[1];
            const endLine = lineInfoMatch[2]; // This is the number after -L, or undefined

            let displayFilename = filenameFromPath; // Start with filename from path

            const trimmedInitialText = initialTextFromNodes.trim(); // Trim for reliable prefix/suffix checks
            let textToParseForFilename = trimmedInitialText;

            const isSourcesContext =
              trimmedInitialText.startsWith("Sources: [") &&
              trimmedInitialText.endsWith("]");

            if (isSourcesContext) {
              const sourcesContentMatch = trimmedInitialText.match(
                /^Sources:\s+\[(.*)\]$/
              );
              if (sourcesContentMatch && sourcesContentMatch[1]) {
                textToParseForFilename = sourcesContentMatch[1].trim(); // Content inside "Sources: [...]"
              }
            }

            // Extract filename hint from (potentially sources-stripped) textToParseForFilename
            // This regex targets the first part that looks like a filename.
            const filenameHintMatch = textToParseForFilename.match(
              /^[\w\/\.-]+(?:\.\w+)?/
            );
            if (filenameHintMatch && filenameHintMatch[0]) {
              // Use filenameHintMatch[0] for the matched string
              // Verify this extracted filename by checking if it's part of the href's path
              if (pathPart.includes(filenameHintMatch[0])) {
                displayFilename = filenameHintMatch[0];
              }
            }

            let lineRefText;
            if (endLine && endLine !== startLine) {
              // Range like L10-L20
              lineRefText = `L${startLine}-L${endLine}`;
            } else {
              // Single line like L10, or L10-L10 treated as L10
              lineRefText = `L${startLine}`;
            }

            let constructedText = `${displayFilename} ${lineRefText}`;

            if (isSourcesContext) {
              finalLinkDisplayText = `Sources: [${constructedText}]`;
            } else {
              // If not a "Sources:" link, use the newly constructed clean text
              finalLinkDisplayText = constructedText;
            }
          }

          // Fallback: if finalLinkDisplayText is empty (e.g. original text was empty and no lineInfoMatch)
          // or if it became empty after processing, use href.
          text = finalLinkDisplayText.trim() || (href ? href : ""); // Ensure text is not empty if href exists

          resultMd = `[${text}](${href})`;
          if (window.getComputedStyle(element).display !== "inline") {
            resultMd += "\n\n";
          }
        } else {
          // Non-http/s/... link, or no href. Fallback text if empty.
          text = text.trim() || (href ? href : "");
          resultMd = text;
          if (
            window.getComputedStyle(element).display !== "inline" &&
            text.trim()
          ) {
            resultMd += "\n\n";
          }
        }
        break;
      }
      case "IMG":
        if (element.closest && element.closest("a")) return "";
        resultMd = element.src
          ? `![${element.alt || ""}](${element.src})\n\n`
          : "";
        break;
      case "BLOCKQUOTE": {
        let qt = "";
        element.childNodes.forEach((c) => {
          try {
            qt += processNode(c);
          } catch (e) {
            console.error("Error processing child of BLOCKQUOTE:", c, e);
            qt += "[err]";
          }
        });
        const trimmedQt = qt.trim();
        if (trimmedQt) {
          resultMd =
            trimmedQt
              .split("\n")
              .map((l) => `> ${l.trim() ? l : ""}`)
              .filter((l) => l.trim() !== ">")
              .join("\n") + "\n\n";
        } else {
          resultMd = "";
        }
        break;
      }
      case "HR":
        resultMd = "\n---\n\n";
        break;
      case "STRONG":
      case "B": {
        let st = "";
        element.childNodes.forEach((c) => {
          try {
            st += processNode(c);
          } catch (e) {
            console.error("Error processing child of STRONG/B:", c, e);
            st += "[err]";
          }
        });
        return `**${st.trim()}**`; // Return directly
      }
      case "EM":
      case "I": {
        let em = "";
        element.childNodes.forEach((c) => {
          try {
            em += processNode(c);
          } catch (e) {
            console.error("Error processing child of EM/I:", c, e);
            em += "[err]";
          }
        });
        return `*${em.trim()}*`; // Return directly
      }
      case "CODE": {
        if (element.parentNode && element.parentNode.nodeName === "PRE") {
          return element.textContent;
        }
        return `\`${element.textContent.trim()}\``; // Return directly
      }
      case "BR":
        if (
          element.parentNode &&
          ["P", "DIV", "LI"].includes(element.parentNode.nodeName)
        ) {
          // Added LI
          const nextSibling = element.nextSibling;
          // Add markdown hard break only if BR is followed by text or is at the end of a line within a block
          if (
            !nextSibling ||
            (nextSibling.nodeType === Node.TEXT_NODE &&
              nextSibling.textContent.trim() !== "") ||
            nextSibling.nodeType === Node.ELEMENT_NODE
          ) {
            return "  \n"; // Return directly
          }
        }
        return ""; // Return directly (or empty if not a hard break)
      case "TABLE": {
        let tableMd = "";
        const headerRows = Array.from(
          element.querySelectorAll(
            ":scope > thead > tr, :scope > tr:first-child"
          )
        );
        const bodyRows = Array.from(
          element.querySelectorAll(":scope > tbody > tr")
        );
        const allRows = Array.from(element.rows); // Fallback

        let rowsToProcessForHeader = headerRows;
        if (headerRows.length === 0 && allRows.length > 0) {
          // Infer header if THEAD is missing
          rowsToProcessForHeader = [allRows[0]];
        }

        if (rowsToProcessForHeader.length > 0) {
          const headerRowElement = rowsToProcessForHeader[0];
          let headerContent = "|";
          let separator = "|";
          Array.from(headerRowElement.cells).forEach((cell) => {
            let cellText = "";
            cell.childNodes.forEach((c) => {
              try {
                cellText += processNode(c);
              } catch (e) {
                console.error(
                  "Error processing child of TH/TD (Header):",
                  c,
                  e
                );
                cellText += "[err]";
              }
            });
            headerContent += ` ${cellText.trim().replace(/\|/g, "\\|")} |`;
            separator += ` --- |`;
          });
          tableMd += `${headerContent}\n${separator}\n`;
        }

        let rowsToProcessForBody = bodyRows;
        if (
          bodyRows.length === 0 &&
          allRows.length > (headerRows.length > 0 ? 1 : 0)
        ) {
          // If no TBODY, take remaining rows
          rowsToProcessForBody =
            headerRows.length > 0 ? allRows.slice(1) : allRows;
        }

        rowsToProcessForBody.forEach((row) => {
          // Ensure we don't re-process a header row if using allRows fallback logic above and header was found
          if (
            rowsToProcessForHeader.length > 0 &&
            rowsToProcessForHeader.includes(row)
          )
            return;

          let rowContent = "|";
          Array.from(row.cells).forEach((cell) => {
            let cellText = "";
            cell.childNodes.forEach((c) => {
              try {
                cellText += processNode(c);
              } catch (e) {
                console.error("Error processing child of TH/TD (Body):", c, e);
                cellText += "[err]";
              }
            });
            rowContent += ` ${cellText
              .trim()
              .replace(/\|/g, "\\|")
              .replace(/\n+/g, " <br> ")} |`;
          });
          tableMd += `${rowContent}\n`;
        });
        resultMd = tableMd + (tableMd ? "\n" : "");
        break;
      }
      case "THEAD":
      case "TBODY":
      case "TFOOT":
      case "TR":
      case "TH":
      case "TD":
        return ""; // Handled by TABLE case, return empty string if processed directly

      case "DETAILS": {
        let summaryText = "Details";
        const summaryElem = element.querySelector("summary");
        if (summaryElem) {
          let tempSummary = "";
          summaryElem.childNodes.forEach((c) => {
            try {
              tempSummary += processNode(c);
            } catch (e) {
              console.error("Error processing child of SUMMARY:", c, e);
              tempSummary += "[err]";
            }
          });
          summaryText = tempSummary.trim() || "Details";
        }
        let detailsContent = "";
        Array.from(element.childNodes).forEach((child) => {
          if (child.nodeName !== "SUMMARY") {
            try {
              detailsContent += processNode(child);
            } catch (e) {
              console.error("Error processing child of DETAILS:", c, e);
              detailsContent += "[err]";
            }
          }
        });
        resultMd = `> **${summaryText}**\n${detailsContent
          .trim()
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")}\n\n`;
        break;
      }
      case "SUMMARY":
        return ""; // Handled by DETAILS

      case "DIV":
      case "SPAN":
      case "SECTION":
      case "ARTICLE":
      case "MAIN":
      default: {
        let txt = "";
        element.childNodes.forEach((c) => {
          try {
            txt += processNode(c);
          } catch (e) {
            console.error(
              "Error processing child of DEFAULT case:",
              c,
              element.nodeName,
              e
            );
            txt += "[err]";
          }
        });

        const d = window.getComputedStyle(element);
        const isBlock = [
          "block",
          "flex",
          "grid",
          "list-item",
          "table",
          "table-row-group",
          "table-header-group",
          "table-footer-group",
        ].includes(d.display);

        if (isBlock && txt.trim()) {
          // Ensure that text from children which already ends in \n\n isn't given more \n\n
          if (txt.endsWith("\n\n")) {
            resultMd = txt;
          } else if (txt.endsWith("\n")) {
            // if it ends with one \n, add one more for spacing
            resultMd = txt + "\n";
          } else {
            // if it has no trailing newlines, add two.
            resultMd = txt.trimEnd() + "\n\n";
          }
        } else {
          // Inline element or empty block element
          return txt; // Return directly
        }
      }
    }
  } catch (error) {
    console.error(
      "Unhandled error in processNode for element:",
      element.nodeName,
      element,
      error
    );
    return `\n[ERROR_PROCESSING_ELEMENT: ${element.nodeName}]\n\n`; // Return an error placeholder
  }
  // console.log("processNode END for:", element.nodeName, "Output:", resultMd.substring(0,50)); // DEBUG
  return resultMd;
}

// Function to auto-detect programming language from code content
function detectCodeLanguage(codeText) {
  if (!codeText || codeText.trim().length < 10) return "";

  const code = codeText.trim();
  const firstLine = code.split("\n")[0].trim();
  const lines = code.split("\n");

  // JavaScript/TypeScript patterns
  if (
    code.includes("function ") ||
    code.includes("const ") ||
    code.includes("let ") ||
    code.includes("var ") ||
    code.includes("=>") ||
    code.includes("console.log") ||
    code.includes("require(") ||
    code.includes("import ") ||
    code.includes("export ")
  ) {
    if (
      code.includes(": ") &&
      (code.includes("interface ") ||
        code.includes("type ") ||
        code.includes("enum ") ||
        code.includes("implements "))
    ) {
      return "typescript";
    }
    return "javascript";
  }

  // Python patterns
  if (
    code.includes("def ") ||
    code.includes("import ") ||
    code.includes("from ") ||
    code.includes("print(") ||
    code.includes("if __name__") ||
    code.includes("class ") ||
    (firstLine.startsWith("#!") && firstLine.includes("python"))
  ) {
    return "python";
  }

  // Java patterns
  if (
    code.includes("public class ") ||
    code.includes("private ") ||
    code.includes("public static void main") ||
    code.includes("System.out.println") ||
    code.includes("import java.")
  ) {
    return "java";
  }

  // C# patterns
  if (
    code.includes("using System") ||
    code.includes("namespace ") ||
    code.includes("public class ") ||
    code.includes("Console.WriteLine") ||
    code.includes("[Attribute]")
  ) {
    return "csharp";
  }

  // C/C++ patterns
  if (
    code.includes("#include") ||
    code.includes("int main") ||
    code.includes("printf(") ||
    code.includes("cout <<") ||
    code.includes("std::")
  ) {
    return code.includes("std::") || code.includes("cout") ? "cpp" : "c";
  }

  // Go patterns
  if (
    code.includes("package ") ||
    code.includes("func ") ||
    code.includes("import (") ||
    code.includes("fmt.Printf") ||
    code.includes("go ")
  ) {
    return "go";
  }

  // Rust patterns
  if (
    code.includes("fn ") ||
    code.includes("let mut") ||
    code.includes("println!") ||
    code.includes("use std::") ||
    code.includes("impl ")
  ) {
    return "rust";
  }

  // PHP patterns
  if (
    code.includes("<?php") ||
    (code.includes("$") && (code.includes("echo ") || code.includes("print ")))
  ) {
    return "php";
  }

  // Ruby patterns
  if (
    code.includes("def ") &&
    (code.includes("end") ||
      code.includes("puts ") ||
      code.includes("require "))
  ) {
    return "ruby";
  }

  // Shell/Bash patterns
  if (
    (firstLine.startsWith("#!") &&
      (firstLine.includes("bash") || firstLine.includes("sh"))) ||
    code.includes("#!/bin/") ||
    (code.includes("echo ") && code.includes("$"))
  ) {
    return "bash";
  }

  // SQL patterns
  if (code.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i)) {
    return "sql";
  }

  // CSS patterns
  if (
    code.includes("{") &&
    code.includes("}") &&
    code.includes(":") &&
    (code.includes("color:") ||
      code.includes("margin:") ||
      code.includes("padding:") ||
      code.includes("#"))
  ) {
    return "css";
  }

  // HTML patterns
  if (
    code.includes("<") &&
    code.includes(">") &&
    (code.includes("<!DOCTYPE") ||
      code.includes("<html") ||
      code.includes("<div") ||
      code.includes("<p"))
  ) {
    return "html";
  }

  // XML patterns
  if (
    code.includes("<?xml") ||
    (code.includes("<") && code.includes(">") && code.includes("</"))
  ) {
    return "xml";
  }

  // JSON patterns
  if (
    (code.startsWith("{") && code.endsWith("}")) ||
    (code.startsWith("[") && code.endsWith("]"))
  ) {
    try {
      JSON.parse(code);
      return "json";
    } catch (e) {
      // Not valid JSON
    }
  }

  // YAML patterns
  if (
    lines.some(
      (line) =>
        line.match(/^\s*\w+:\s*/) && !line.includes("{") && !line.includes(";")
    )
  ) {
    return "yaml";
  }

  // Markdown patterns
  if (
    code.includes("# ") ||
    code.includes("## ") ||
    code.includes("```") ||
    (code.includes("[") && code.includes("]("))
  ) {
    return "markdown";
  }

  // Docker patterns
  if (
    firstLine.startsWith("FROM ") ||
    code.includes("RUN ") ||
    code.includes("COPY ") ||
    code.includes("WORKDIR ")
  ) {
    return "dockerfile";
  }

  // Default fallback
  return "";
}

// Create floating export button on page
function createFloatingExportButton() {
  // Check if button already exists
  const existingBtn = document.getElementById("deepwiki-export-btn");
  if (existingBtn) {
    const existingSelect = existingBtn.querySelector("#export-translate-lang");
    if (existingSelect) {
      applyPreferredLangToSelect(existingSelect);
    }
    return;
  }

  const exportBtn = document.createElement("div");
  exportBtn.id = "deepwiki-export-btn";
  exportBtn.innerHTML = `
    <div class="deepwiki-export-main-btn" id="main-export-btn">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14,2 14,8 20,8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10,9 9,9 8,9"></polyline>
      </svg>
      <span>导出</span>
    </div>
    <div class="deepwiki-export-menu" id="export-menu" style="display: none;">
      <div class="deepwiki-export-option" id="export-single">导出当前页</div>
      <div class="deepwiki-export-option" id="export-batch">批量导出</div>
      <div class="deepwiki-export-translate-section">
        <label for="export-translate-lang">翻译语言:</label>
        <select id="export-translate-lang" class="deepwiki-translate-select">
          <option value="">不翻译</option>
          <option value="zh-CN">中文（简体）</option>
          <option value="zh-TW">中文（繁体）</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
          <option value="fr">法语</option>
          <option value="de">德语</option>
          <option value="es">西班牙语</option>
          <option value="pt">葡萄牙语</option>
          <option value="ru">俄语</option>
        </select>
      </div>
    </div>
  `;

  // Add styles
  exportBtn.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
  `;

  // Add CSS for the button with unique prefixes to avoid conflicts
  const style = document.createElement("style");
  style.textContent = `
    #deepwiki-export-btn .deepwiki-export-main-btn {
      background: #4F46E5 !important;
      color: white !important;
      padding: 8px 12px !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3) !important;
      transition: all 0.2s ease !important;
      user-select: none !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      border: none !important;
      margin: 0 !important;
    }
    
    #deepwiki-export-btn .deepwiki-export-main-btn:hover {
      background: #4338CA !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4) !important;
    }
    
    #deepwiki-export-btn .deepwiki-export-menu {
      position: absolute !important;
      top: 100% !important;
      right: 0 !important;
      margin-top: 4px !important;
      background: white !important;
      border: 1px solid #E5E7EB !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
      overflow: visible !important;
      min-width: 220px !important;
      z-index: 10002 !important;
    }
    
    #deepwiki-export-btn .deepwiki-export-option {
      padding: 10px 16px !important;
      cursor: pointer !important;
      color: #374151 !important;
      transition: background-color 0.15s ease !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      border: none !important;
      margin: 0 !important;
    }
    
    #deepwiki-export-btn .deepwiki-export-option:hover {
      background: #F3F4F6 !important;
    }
    
    #deepwiki-export-btn .deepwiki-export-option:not(:last-of-type) {
      border-bottom: 1px solid #F3F4F6 !important;
    }
    
    #deepwiki-export-btn .deepwiki-export-translate-section {
      padding: 12px 16px !important;
      border-top: 1px solid #F3F4F6 !important;
      background: #F9FAFB !important;
    }
    
    #deepwiki-export-btn .deepwiki-export-translate-section label {
      display: block !important;
      font-size: 12px !important;
      color: #374151 !important;
      margin-bottom: 6px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    
    #deepwiki-export-btn .deepwiki-translate-select {
      width: 100% !important;
      padding: 6px 8px !important;
      border: 1px solid #D1D5DB !important;
      border-radius: 4px !important;
      background: white !important;
      font-size: 12px !important;
      color: #374151 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      cursor: pointer !important;
      outline: none !important;
      box-sizing: border-box !important;
    }

    #deepwiki-export-btn .deepwiki-translate-select:focus {
      border-color: #4F46E5 !important;
      box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1) !important;
    }

    #deepwiki-export-btn .deepwiki-translate-select option {
      padding: 4px 8px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    
    .deepwiki-export-status {
      position: fixed !important;
      top: 80px !important;
      right: 20px !important;
      z-index: 10001 !important;
      background: white !important;
      border: 1px solid #E5E7EB !important;
      border-radius: 8px !important;
      padding: 12px 16px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 13px !important;
      max-width: 280px !important;
      word-wrap: break-word !important;
    }
    
    .deepwiki-export-status.success {
      border-color: #10B981 !important;
      color: #065F46 !important;
      background: #ECFDF5 !important;
    }
    
    .deepwiki-export-status.error {
      border-color: #EF4444 !important;
      color: #991B1B !important;
      background: #FEF2F2 !important;
    }
    
    .deepwiki-export-status.info {
      border-color: #3B82F6 !important;
      color: #1E40AF !important;
      background: #EFF6FF !important;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(exportBtn);

  // Add event listeners
  const mainBtn = document.getElementById("main-export-btn");
  const menu = document.getElementById("export-menu");
  const singleExport = document.getElementById("export-single");
  const batchExport = document.getElementById("export-batch");

  let menuVisible = false;

  mainBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuVisible = !menuVisible;
    menu.style.display = menuVisible ? "block" : "none";
  });

  document.addEventListener("click", (e) => {
    if (menuVisible) {
      // Check if click is inside the export menu
      const isInsideMenu = menu.contains(e.target);
      const isMainBtn = mainBtn.contains(e.target);

      if (!isInsideMenu && !isMainBtn) {
        menuVisible = false;
        menu.style.display = "none";
      }
    }
  });

  singleExport.addEventListener("click", () => {
    menu.style.display = "none";
    menuVisible = false;
    exportCurrentPage();
  });

  batchExport.addEventListener("click", () => {
    const translateLang = document.getElementById(
      "export-translate-lang"
    ).value;
    menu.style.display = "none";
    menuVisible = false;
    exportAllPages(translateLang);
  });

  // Prevent menu from closing when clicking on translate select
  const translateSelect = document.getElementById("export-translate-lang");
  applyPreferredLangToSelect(translateSelect);
  translateSelect.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Handle translate select change
  translateSelect.addEventListener("change", (e) => {
    e.stopPropagation();
    // Keep menu open after selection
    saveTranslatePreference(translateSelect.value);
  });

  // Prevent menu from closing when clicking on translate section
  const translateSection = document.querySelector(
    ".deepwiki-export-translate-section"
  );
  translateSection.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

// Show status message
function showExportStatus(message, type = "info", duration = 3000) {
  // Remove existing status
  const existingStatus = document.querySelector(".deepwiki-export-status");
  if (existingStatus) {
    existingStatus.remove();
  }

  const status = document.createElement("div");
  status.className = `deepwiki-export-status ${type}`;
  status.textContent = message;
  document.body.appendChild(status);

  if (duration > 0) {
    setTimeout(() => {
      if (status.parentNode) {
        status.remove();
      }
    }, duration);
  }

  return status;
}

const translationCache = new Map();

// Remove any legacy Google Translate widgets or scripts that older versions injected
function removeLegacyGoogleTranslateArtifacts() {
  const legacyScripts = document.querySelectorAll(
    'script[src*="translate.google.com/translate_a/element.js"]'
  );
  legacyScripts.forEach((script) => {
    if (script && script.parentNode) {
      script.parentNode.removeChild(script);
    }
  });

  const legacyWidgets = document.querySelectorAll(
    "#google_translate_element, .goog-te-banner-frame, .goog-te-gadget"
  );
  legacyWidgets.forEach((element) => element.remove());
}

// Translate page to specified language automatically
async function translatePageTo(requestedLang) {
  let targetLang = await resolveTargetLanguage(requestedLang);

  if (!targetLang) {
    return true; // No translation needed
  }

  if (document.body.dataset.translatedLang === targetLang) {
    showExportStatus("页面已翻译完成", "success", 2000);
    return true;
  }

  if (isPageTranslatedTo(targetLang)) {
    markPageTranslated(targetLang);
    showExportStatus("页面已翻译完成", "success", 2000);
    return true;
  }

  const languageName = getLanguageName(targetLang);
  showExportStatus(`正在自动翻译页面到 ${languageName}...`, "info", 0);

  document.body.dataset.translating = targetLang;
  try {
    const contentContainer =
      document.querySelector(".container > div:nth-child(2) .prose") ||
      document.querySelector(".container > div:nth-child(2) .prose-custom") ||
      document.querySelector(".container > div:nth-child(2)") ||
      document.body;

    if (!contentContainer) {
      showExportStatus("未找到页面内容，翻译已跳过", "warning", 4000);
      return false;
    }

    const textNodes = collectTranslatableTextNodes(contentContainer);

    if (textNodes.length === 0) {
      markPageTranslated(targetLang);
      showExportStatus("页面无需翻译", "success", 2000);
      return true;
    }

    // Remove any legacy Google Translate widgets/scripts to avoid CSP errors
    removeLegacyGoogleTranslateArtifacts();

    const totalSegments = textNodes.filter((info) => info.trimmed).length;
    let processed = 0;
    let successfulSegments = 0;

    const pendingInfos = [];

    for (const info of textNodes) {
      if (!info.trimmed) continue;
      const cacheKey = `${targetLang}::${info.trimmed}`;
      if (translationCache.has(cacheKey)) {
        const cached = translationCache.get(cacheKey);
        info.node.nodeValue = `${info.leading}${cached}${info.trailing}`;
        if (cached && cached.trim()) {
          successfulSegments++;
        }
        processed++;
      } else {
        pendingInfos.push(info);
      }
    }

    if (processed && processed % 10 === 0 && processed < totalSegments) {
      showExportStatus(
        `正在自动翻译页面到 ${languageName} (${processed}/${totalSegments})...`,
        "info",
        0
      );
    }

    const SENTINEL = "\uE000\uE001\uE002";
    const MAX_CHARS_PER_CHUNK = 4000;
    const MAX_NODES_PER_CHUNK = 48;

    while (pendingInfos.length > 0) {
      const chunk = [];
      let chunkCharCount = 0;

      while (chunk.length < MAX_NODES_PER_CHUNK && pendingInfos.length > 0) {
        const next = pendingInfos.shift();
        const nextLength = next.trimmed.length;

        if (
          chunk.length > 0 &&
          chunkCharCount + nextLength + SENTINEL.length > MAX_CHARS_PER_CHUNK
        ) {
          pendingInfos.unshift(next);
          break;
        }

        chunk.push(next);
        chunkCharCount += nextLength + SENTINEL.length;
      }

      if (chunk.length === 0) {
        break;
      }

      const chunkTexts = chunk.map((info) => info.trimmed);
      const cacheKeys = chunkTexts.map((text) => `${targetLang}::${text}`);

      let translatedParts = null;

      // Check if entire chunk is now cached (due to duplicates processed earlier)
      if (cacheKeys.every((key) => translationCache.has(key))) {
        translatedParts = cacheKeys.map((key) => translationCache.get(key));
      } else {
        if (!chunkTexts.some((text) => text.includes(SENTINEL))) {
          try {
            const combinedText = chunkTexts.join(SENTINEL);
            const combinedTranslation = await translateTextViaApi(
              combinedText,
              targetLang
            );
            translatedParts = combinedTranslation.split(SENTINEL);
          } catch (error) {
            console.warn("批量翻译失败，回退到单段翻译", error);
          }
        }
      }

      if (!translatedParts || translatedParts.length !== chunk.length) {
        translatedParts = [];
        for (const info of chunk) {
          try {
            const translated = await translateTextWithCache(
              info.trimmed,
              targetLang
            );
            translatedParts.push(translated);
          } catch (segmentError) {
            console.warn(
              "翻译段落失败，已保留原文:",
              info.trimmed,
              segmentError
            );
            translatedParts.push(null);
          }
          await sleep(50);
        }
      }

      chunk.forEach((info, index) => {
        const translated = translatedParts[index];
        if (translated != null) {
          const key = `${targetLang}::${info.trimmed}`;
          translationCache.set(key, translated);
          info.node.nodeValue = `${info.leading}${translated}${info.trailing}`;
          if (translated.trim()) {
            successfulSegments++;
          }
        }
        processed++;
      });

      showExportStatus(
        `正在自动翻译页面到 ${languageName} (${Math.min(
          processed,
          totalSegments
        )}/${totalSegments})...`,
        "info",
        0
      );

      await sleep(80);
    }

    if (successfulSegments === 0) {
      showExportStatus("自动翻译服务暂时不可用，已保留原文", "warning", 5000);
      return false;
    }

    markPageTranslated(targetLang);
    showExportStatus("自动翻译成功", "success", 2000);
    return true;
  } catch (error) {
    console.error("Translation failed:", error);
    showExportStatus("自动翻译服务暂时不可用，已保留原文", "warning", 5000);
    return false;
  } finally {
    delete document.body.dataset.translating;
  }
}

// Get language name for display
function getLanguageName(langCode) {
  const langNames = {
    "zh-CN": "中文（简体）",
    "zh-TW": "中文（繁体）",
    ja: "日语",
    ko: "韩语",
    fr: "法语",
    de: "德语",
    es: "西班牙语",
    pt: "葡萄牙语",
    ru: "俄语",
  };
  return langNames[langCode] || langCode;
}

// Collect text nodes inside the main article that can be translated
function collectTranslatableTextNodes(root) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const value = node.nodeValue || "";
        if (!value.trim()) return NodeFilter.FILTER_REJECT;

        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        if (
          parent.closest(
            ".deepwiki-export-status, pre, code, kbd, samp, var, script, style, noscript"
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip SVG/Canvas or other non-visible elements
        if (parent.closest("svg, canvas")) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    },
    false
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue;
    if (!text) continue;

    const leading = text.match(/^\s*/)?.[0] ?? "";
    const trailing = text.match(/\s*$/)?.[0] ?? "";
    const trimmed = text.trim();

    textNodes.push({ node, leading, trailing, trimmed });
  }

  return textNodes;
}

// Translate a text segment with caching support
async function translateTextWithCache(text, targetLang) {
  const cacheKey = `${targetLang}::${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const translated = await translateTextViaApi(text, targetLang);
  translationCache.set(cacheKey, translated);
  return translated;
}

// Perform translation using Google translate public endpoint
async function translateTextViaApi(text, targetLang) {
  const segments = splitTextForTranslation(text);
  const translatedSegments = [];

  for (const segment of segments) {
    const params = new URLSearchParams({
      client: "gtx",
      sl: "auto",
      tl: targetLang,
      dt: "t",
      q: segment,
    });

    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Translate API responded with ${response.status}`);
    }

    const data = await response.json();
    const translatedSegment =
      data?.[0]?.map((part) => part?.[0] ?? "").join("") || "";
    translatedSegments.push(translatedSegment);

    // Small delay between requests to be polite
    await sleep(40);
  }

  return translatedSegments.join("");
}

// Split long text into smaller chunks to respect API limits
function splitTextForTranslation(text, maxLength = 1800) {
  if (text.length <= maxLength) {
    return [text];
  }

  const segments = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("。", maxLength);
    if (splitIndex < maxLength * 0.5) {
      splitIndex =
        remaining.lastIndexOf(". ", maxLength) !== -1
          ? remaining.lastIndexOf(". ", maxLength) + 1
          : maxLength;
    }

    segments.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    segments.push(remaining);
  }

  return segments.filter(Boolean);
}

// Mark the page as translated so we can skip future work
function markPageTranslated(targetLang) {
  document.documentElement.lang = targetLang;
  document.body.dataset.translate = "translated";
  document.body.dataset.translatedLang = targetLang;

  const contentContainer =
    document.querySelector(".container > div:nth-child(2) .prose") ||
    document.querySelector(".container > div:nth-child(2) .prose-custom") ||
    document.querySelector(".container > div:nth-child(2)");

  if (contentContainer) {
    contentContainer.setAttribute("data-translate", "translated");
    contentContainer.dataset.translatedLang = targetLang;
  }

  if (document.body.dataset.translating === targetLang) {
    delete document.body.dataset.translating;
  }
}

// Utility sleep helper
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  try {
    const resolved = new URL(url, window.location.origin).href;
    return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
  } catch (error) {
    return url;
  }
}

function getArticleContainer() {
  return (
    document.querySelector(".container > div:nth-child(2) .prose") ||
    document.querySelector(".container > div:nth-child(2) .prose-custom") ||
    document.querySelector(".container > div:nth-child(2)") ||
    document.body
  );
}

function findSidebarLinkByUrl(targetUrl) {
  const normalizedTarget = normalizeUrl(targetUrl);
  const links = Array.from(
    document.querySelectorAll(".border-r-border a[href]") || []
  );
  return links.find((link) => {
    const href = link.getAttribute("href");
    if (!href) return false;
    const normalizedHref = normalizeUrl(href);
    return normalizedHref === normalizedTarget;
  });
}

function simulateAnchorClick(anchor) {
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };

  if (window.PointerEvent) {
    anchor.dispatchEvent(new PointerEvent("pointerdown", eventOptions));
    anchor.dispatchEvent(new MouseEvent("mousedown", eventOptions));
    anchor.dispatchEvent(new PointerEvent("pointerup", eventOptions));
    anchor.dispatchEvent(new MouseEvent("mouseup", eventOptions));
  } else {
    anchor.dispatchEvent(new MouseEvent("mousedown", eventOptions));
    anchor.dispatchEvent(new MouseEvent("mouseup", eventOptions));
  }
  anchor.dispatchEvent(new MouseEvent("click", eventOptions));
}

async function waitForUrlAndContent(targetUrl, maxWaitTime = 20000) {
  const start = Date.now();
  const normalizedTarget = normalizeUrl(targetUrl);

  while (Date.now() - start < maxWaitTime) {
    if (normalizeUrl(window.location.href) === normalizedTarget) {
      const container = getArticleContainer();
      if (container && container.textContent.trim().length > 0) {
        return true;
      }
    }
    await sleep(200);
  }

  return false;
}

async function navigateUsingSidebar(targetUrl, options = {}) {
  const { maxWaitTime = 22000 } = options;
  const normalizedTarget = normalizeUrl(targetUrl);

  if (normalizeUrl(window.location.href) === normalizedTarget) {
    return true;
  }

  const anchor = findSidebarLinkByUrl(normalizedTarget);
  if (!anchor) {
    console.warn("Sidebar link not found for target URL", normalizedTarget);
    return false;
  }

  try {
    if (typeof anchor.scrollIntoView === "function") {
      anchor.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    simulateAnchorClick(anchor);
  } catch (error) {
    console.warn("Failed to simulate sidebar click", error);
    return false;
  }

  const success = await waitForUrlAndContent(normalizedTarget, maxWaitTime);
  if (!success) {
    console.warn("Timed out waiting for navigation to", normalizedTarget);
  }
  return success;
}

// Check if page is already translated to target language
function isPageTranslatedTo(targetLang) {
  if (!targetLang) {
    return false;
  }

  if (document.body.dataset.translatedLang === targetLang) {
    return true;
  }

  const currentLang = document.documentElement.lang;
  if (
    currentLang &&
    currentLang.toLowerCase().startsWith(targetLang.toLowerCase())
  ) {
    return true;
  }

  if (targetLang === "zh-CN" || targetLang === "zh-TW") {
    const contentContainer =
      document.querySelector(".container > div:nth-child(2) .prose") ||
      document.querySelector(".container > div:nth-child(2) .prose-custom") ||
      document.querySelector(".container > div:nth-child(2)");

    if (contentContainer) {
      const text = contentContainer.textContent;
      const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const totalCharCount = text.length;

      if (totalCharCount > 0 && chineseCharCount / totalCharCount > 0.2) {
        return true;
      }
    }
  }

  return false;
}

// Wait for translation (either Chrome auto translation or our own) to settle
async function waitForTranslation(targetLang = "", maxWaitTime = 12000) {
  let normalizedTarget = "";
  if (typeof targetLang === "number") {
    maxWaitTime = targetLang;
    targetLang = "";
  }
  if (typeof maxWaitTime !== "number" || Number.isNaN(maxWaitTime)) {
    maxWaitTime = 12000;
  }
  if (typeof targetLang === "string") {
    normalizedTarget = targetLang.trim().toLowerCase();
  }

  const startTime = Date.now();
  const checkInterval = 350;

  return new Promise((resolve) => {
    const checkTranslation = () => {
      const now = Date.now();
      if (now - startTime > maxWaitTime) {
        console.warn("Translation wait timeout");
        resolve(false);
        return;
      }

      const translatingLang = document.body.dataset.translating || "";
      if (
        translatingLang &&
        normalizedTarget &&
        translatingLang.toLowerCase().startsWith(normalizedTarget)
      ) {
        setTimeout(checkTranslation, checkInterval);
        return;
      }

      const bodyTranslated = (
        document.body.dataset.translatedLang || ""
      ).toLowerCase();
      if (normalizedTarget && bodyTranslated.startsWith(normalizedTarget)) {
        resolve(true);
        return;
      }
      if (!normalizedTarget && bodyTranslated) {
        resolve(true);
        return;
      }

      const htmlLang = (document.documentElement.lang || "").toLowerCase();
      if (
        normalizedTarget &&
        htmlLang &&
        (htmlLang === normalizedTarget || htmlLang.startsWith(normalizedTarget))
      ) {
        resolve(true);
        return;
      }

      if (normalizedTarget && isPageTranslatedTo(normalizedTarget)) {
        resolve(true);
        return;
      }

      const hasTranslatedContent = document.querySelector(
        '[data-translate="translated"], .translated, [translate="yes"]'
      );
      const hasGoogleTranslate =
        document.body.classList.contains("translated-ltr") ||
        document.body.classList.contains("translated-rtl");
      const hasTranslateAttribute =
        document.documentElement.getAttribute("translate") === "yes" ||
        document.documentElement.hasAttribute("translate");

      const contentContainer = getArticleContainer();
      let chineseRatio = 0;
      if (contentContainer) {
        const text = contentContainer.textContent || "";
        const totalCharCount = text.length;
        if (totalCharCount > 0) {
          const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || [])
            .length;
          chineseRatio = chineseCharCount / totalCharCount;
        }
      }

      if (!normalizedTarget) {
        if (
          hasGoogleTranslate ||
          hasTranslateAttribute ||
          hasTranslatedContent
        ) {
          if (chineseRatio === 0 || chineseRatio > 0.08) {
            resolve(true);
            return;
          }
        } else if (chineseRatio > 0.22) {
          resolve(true);
          return;
        }
      }

      setTimeout(checkTranslation, checkInterval);
    };

    checkTranslation();
  });
}

// Export current page function
async function exportCurrentPage() {
  try {
    showExportStatus("正在转换当前页面...", "info", 0);

    const preferredLang = await resolveTargetLanguage(undefined);
    let translated = false;
    if (preferredLang) {
      translated = await translatePageTo(preferredLang);
    }

    const waitLang = translated ? preferredLang : "";
    const waitTimeout = translated ? 18000 : 6000;
    await waitForTranslation(waitLang, waitTimeout);

    // Get page title from head
    const headTitle = document.title || "";
    const formattedHeadTitle = headTitle
      .replace(/[\/|]/g, "-")
      .replace(/\s+/g, "-")
      .replace("---", "-");

    const title =
      document
        .querySelector('.container > div:nth-child(1) a[data-selected="true"]')
        ?.textContent?.trim() ||
      document
        .querySelector(".container > div:nth-child(1) h1")
        ?.textContent?.trim() ||
      document.querySelector("h1")?.textContent?.trim() ||
      "Untitled";

    const contentContainer =
      document.querySelector(".container > div:nth-child(2) .prose") ||
      document.querySelector(".container > div:nth-child(2) .prose-custom") ||
      document.querySelector(".container > div:nth-child(2)") ||
      document.body;

    let markdown = ``;
    let markdownTitle = title.replace(/\s+/g, "-");

    contentContainer.childNodes.forEach((child) => {
      markdown += processNode(child);
    });

    markdown = markdown.trim().replace(/\n{3,}/g, "\n\n");

    // Create filename
    const fileName = formattedHeadTitle
      ? `${formattedHeadTitle}-${markdownTitle}.md`
      : `${markdownTitle}.md`;

    // Download file
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showExportStatus("✓ 当前页面导出成功！", "success");
  } catch (error) {
    console.error("Export current page error:", error);
    showExportStatus("✗ 导出失败: " + error.message, "error");
  }
}

// Get sidebar structure with hierarchy
function getSidebarStructure() {
  const structure = [];
  const sidebarContainer = document.querySelector(".border-r-border ul");

  if (!sidebarContainer) {
    return { structure: [], flatList: [] };
  }

  const flatList = [];

  function parseLevel(container, level = 0) {
    const items = [];
    const directChildren = Array.from(container.children).filter(
      (child) => child.tagName === "LI"
    );

    for (const li of directChildren) {
      const link = li.querySelector(":scope > a");
      if (link) {
        const href = link.getAttribute("href");
        const title = link.textContent.trim();
        const isSelected = link.getAttribute("data-selected") === "true";

        if (href && title) {
          const baseUrl = window.location.origin;
          const fullUrl = new URL(href, baseUrl).href;

          const item = {
            title,
            url: fullUrl,
            selected: isSelected,
            level,
            children: [],
          };

          // Check for nested ul
          const nestedUl = li.querySelector(":scope > ul");
          if (nestedUl) {
            item.children = parseLevel(nestedUl, level + 1);
          }

          items.push(item);

          // Add to flat list with level info
          flatList.push({
            title,
            url: fullUrl,
            selected: isSelected,
            level,
            path: title, // Will be updated to full path
          });

          // Add children to flat list
          function addChildrenToFlatList(children, parentPath) {
            for (const child of children) {
              const childItem = flatList[flatList.length - 1];
              if (child.title === childItem.title) {
                childItem.path = `${parentPath}/${child.title}`;
              }
              if (child.children.length > 0) {
                addChildrenToFlatList(child.children, childItem.path);
              }
            }
          }

          if (item.children.length > 0) {
            addChildrenToFlatList(item.children, title);
          }
        }
      }
    }

    return items;
  }

  const hierarchicalStructure = parseLevel(sidebarContainer);

  return {
    structure: hierarchicalStructure,
    flatList,
  };
}

// Export all pages function
async function exportAllPages(translateLang) {
  try {
    const finalTranslateLang =
      translateLang === undefined
        ? await resolveTargetLanguage(undefined)
        : translateLang;

    if (finalTranslateLang) {
      showExportStatus(
        `正在提取页面链接并准备翻译为 ${getLanguageName(
          finalTranslateLang
        )}...`,
        "info",
        0
      );
    } else {
      showExportStatus("正在提取页面链接...", "info", 0);
    }

    const { structure, flatList } = getSidebarStructure();

    if (flatList.length === 0) {
      showExportStatus("✗ 未找到页面链接", "error");
      return;
    }

    const headTitle = document.title || "";
    const formattedHeadTitle = headTitle
      .replace(/[\/|]/g, "-")
      .replace(/\s+/g, "-")
      .replace("---", "-");
    const folderName = formattedHeadTitle || "deepwiki-export";

    const originalUrl = normalizeUrl(window.location.href);
    let activeUrl = originalUrl;
    let processedCount = 0;
    let errorCount = 0;
    const convertedPages = [];

    showExportStatus(
      finalTranslateLang
        ? `找到 ${
            flatList.length
          } 个页面，开始批量转换并翻译为 ${getLanguageName(
            finalTranslateLang
          )}...`
        : `找到 ${flatList.length} 个页面，开始批量转换...`,
      "info",
      0
    );

    for (const page of flatList) {
      try {
        showExportStatus(
          `正在处理 ${processedCount + 1}/${flatList.length}: ${page.title}`,
          "info",
          0
        );

        const targetUrl = normalizeUrl(page.url);
        if (targetUrl !== activeUrl) {
          const navigated = await navigateUsingSidebar(targetUrl);

          if (!navigated) {
            console.warn("Falling back to direct navigation for", targetUrl);
            window.location.href = targetUrl;
            await waitForUrlAndContent(targetUrl, 25000);
          }

          activeUrl = normalizeUrl(window.location.href);
          await sleep(1200);
        }

        // Translate page if language is specified
        let translatedByExtension = false;
        if (finalTranslateLang) {
          showExportStatus(
            `正在翻译页面 ${processedCount + 1}/${flatList.length}: ${
              page.title
            }`,
            "info",
            0
          );
          translatedByExtension = await translatePageTo(finalTranslateLang);
        }

        // Wait for translation to complete
        const waitLang = translatedByExtension ? finalTranslateLang : "";
        const waitTimeout = translatedByExtension ? 18000 : 9000;
        await waitForTranslation(waitLang, waitTimeout);

        // Convert page content
        const title =
          document
            .querySelector(
              '.container > div:nth-child(1) a[data-selected="true"]'
            )
            ?.textContent?.trim() ||
          document
            .querySelector(".container > div:nth-child(1) h1")
            ?.textContent?.trim() ||
          document.querySelector("h1")?.textContent?.trim() ||
          "Untitled";

        const contentContainer = getArticleContainer();

        let markdown = ``;
        contentContainer.childNodes.forEach((child) => {
          markdown += processNode(child);
        });
        markdown = markdown.trim().replace(/\n{3,}/g, "\n\n");

        // Create file path that preserves hierarchy
        const safePath = page.path.replace(/[<>:"|?*]/g, "-");
        const fileName = `${safePath}.md`;

        convertedPages.push({
          fileName,
          content: markdown,
          level: page.level,
          originalTitle: page.title,
        });

        processedCount++;
      } catch (err) {
        errorCount++;
        console.error(`处理页面失败: ${page.title}`, err);
      }
    }

    // Return to original page
    if (normalizeUrl(window.location.href) !== originalUrl) {
      const returned = await navigateUsingSidebar(originalUrl);
      if (!returned) {
        window.location.href = originalUrl;
      }
    }

    // Create and download ZIP file
    if (convertedPages.length > 0) {
      showExportStatus("正在创建ZIP文件...", "info", 0);
      await createAndDownloadZip(convertedPages, folderName);
      showExportStatus(
        `✓ 批量导出完成！成功: ${processedCount}, 失败: ${errorCount}`,
        "success"
      );
    } else {
      showExportStatus("✗ 没有成功转换的页面", "error");
    }
  } catch (error) {
    console.error("Batch export error:", error);
    showExportStatus("✗ 批量导出失败: " + error.message, "error");
  }
}

// Create and download ZIP file
async function createAndDownloadZip(pages, folderName) {
  // Use JSZip if available, otherwise create individual files
  if (typeof JSZip !== "undefined" && JSZip) {
    const zip = new JSZip();

    // Create index file
    let indexContent = `# ${folderName}\n\n## 内容索引\n\n`;

    // Group by level for better organization
    const levelMap = new Map();
    pages.forEach((page) => {
      if (!levelMap.has(page.level)) {
        levelMap.set(page.level, []);
      }
      levelMap.get(page.level).push(page);
    });

    // Create hierarchical index
    for (const [level, levelPages] of levelMap) {
      const indent = "  ".repeat(level);
      levelPages.forEach((page) => {
        indexContent += `${indent}- [${page.originalTitle}](${page.fileName})\n`;
      });
    }

    zip.file("README.md", indexContent);

    // Add all markdown files
    pages.forEach((page) => {
      zip.file(page.fileName, page.content);
    });

    // Generate and download ZIP
    const zipContent = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    const url = URL.createObjectURL(zipContent);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folderName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else {
    // Fallback: download individual files
    pages.forEach((page) => {
      const blob = new Blob([page.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = page.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
}

// Initialize floating button when page loads
function initializeExportButton() {
  const createWithPreference = () => {
    ensureTranslatePreferenceLoaded().then(() => {
      createFloatingExportButton();
    });
  };

  // Wait for page content to load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createWithPreference);
  } else {
    createWithPreference();
  }

  // Also create button on URL changes (for SPA navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(createWithPreference, 1000); // Delay to ensure page content loads
    }
  }).observe(document, { subtree: true, childList: true });
}

// Initialize
initializeExportButton();

// Notify the background script that the content script is ready
chrome.runtime.sendMessage({ action: "contentScriptReady" });
