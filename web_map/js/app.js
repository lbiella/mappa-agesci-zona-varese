const basemaps = {
  voyager: {
    label: "Carto Voyager",
    sourceId: "base-voyager",
    layerId: "base-voyager",
    tiles: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
    ],
    attribution: "© OpenStreetMap contributors © CARTO"
  },
  positron: {
    label: "Carto Positron",
    sourceId: "base-positron",
    layerId: "base-positron",
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    ],
    attribution: "© OpenStreetMap contributors © CARTO"
  },
  osm: {
    label: "OpenStreetMap",
    sourceId: "base-osm",
    layerId: "base-osm",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
    ],
    attribution: "© OpenStreetMap contributors"
  },
  hot: {
    label: "OSM HOT",
    sourceId: "base-hot",
    layerId: "base-hot",
    tiles: [
      "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
    ],
    attribution: "© OpenStreetMap contributors, Tiles style by HOT"
  }
};

const style = {
  version: 8,
  sources: Object.fromEntries(
    Object.values(basemaps).map(def => [
      def.sourceId,
      {
        type: "raster",
        tiles: def.tiles,
        tileSize: 256,
        attribution: def.attribution
      }
    ])
  ),
  layers: Object.entries(basemaps).map(([key, def]) => ({
    id: def.layerId,
    type: "raster",
    source: def.sourceId,
    layout: {
      visibility: key === "voyager" ? "visible" : "none"
    }
  }))
};

const map = new maplibregl.Map({
  container: "map",
  style,
  center: [8.80, 45.82],
  zoom: 9.2
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");

let esagoniData = null;
let gruppiData = null;
let gruppiVicineData = null;
let top5Data = null;
let activePopup = null;
let currentMode = "classe";
let selectedHexId = null;
let profileScales = {};
let gruppiVisible = true;
let gruppiVicineVisible = true;

let classVisibility = {
  "priorità educativa scout": true,
  "bacino scout alto": true,
  "fragilità educativa alta": true,
  "priorità ordinaria": true,
  "non significativa": true
};
let top5Visible = true;
let esagoniVisible = true;
let balancing = false;

const classColors = {
  "priorità educativa scout": "#d73027",
  "bacino scout alto": "#fdae61",
  "fragilità educativa alta": "#8073ac",
  "priorità ordinaria": "#d9d9d9",
  "non significativa": "#ffffff"
};

const modeConfig = {
  classe: {
    title: "Classi interpretative dinamiche",
    type: "class"
  },
  priorita_dinamica: {
    title: "Priorità educativa scout dinamica",
    property: "indice_priorita_dinamica"
  },
  fragilita_dinamica: {
    title: "Fragilità educativa dinamica",
    property: "indice_fragilita_dinamica"
  },
  priorita: {
    title: "Indice priorità educativa scout originale",
    property: "indice_priorita_educativa_scout"
  },
  fragilita: {
    title: "Indice fragilità educativa originale",
    property: "indice_fragilita_educativa"
  },
  scout: {
    title: "Indice bacino scout dinamico",
    property: "indice_scout_dinamico"
  },
  stranieri_assoluti: {
    title: "Stranieri 0-14, numero stimato",
    property: "stranieri_0_14_2023",
    numericScale: "absolute",
    max: 60
  },
  stranieri: {
    title: "Quota stranieri 0-14, celle significative",
    property: "rank_quota_stranieri_0_14",
    numericScale: "rank"
  },
  titolo: {
    title: "Basso titolo di studio, rank",
    property: "rank_quota_basso_titolo"
  },
  famiglie: {
    title: "Famiglie numerose, rank",
    property: "rank_quota_fam_numerose"
  },
  abitazione: {
    title: "Residenti per abitazione, rank",
    property: "rank_residenti_per_abit"
  }
};

const weightGroups = {
  fragilita: ["wStranieri", "wTitolo", "wFamiglie", "wAbitazione"],
  scout: ["wBacinoNum", "wQuotaScout", "wDensScout"],
  priorita: ["wScout", "wFragilitaFinale"]
};

const labelIds = {
  wStranieri: "vStranieri",
  wTitolo: "vTitolo",
  wFamiglie: "vFamiglie",
  wAbitazione: "vAbitazione",
  wBacinoNum: "vBacinoNum",
  wQuotaScout: "vQuotaScout",
  wDensScout: "vDensScout",
  wScout: "vScout",
  wFragilitaFinale: "vFragilitaFinale"
};

const defaultWeights = {
  wStranieri: 30,
  wTitolo: 30,
  wFamiglie: 20,
  wAbitazione: 20,
  wBacinoNum: 10,
  wQuotaScout: 40,
  wDensScout: 50,
  wScout: 50,
  wFragilitaFinale: 50
};

function num(value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
    return 0;
  }
  return Number(value);
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
    return "n.d.";
  }
  return Number(value).toFixed(digits);
}

function clamp100(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function sliderValue(id) {
  const input = document.getElementById(id);
  return input ? Number(input.value) : 0;
}

function weight(id) {
  return sliderValue(id) / 100;
}

function setSliderValue(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = String(Math.max(0, Math.min(100, Math.round(value))));
}

function updateWeightLabels() {
  Object.entries(labelIds).forEach(([inputId, labelId]) => {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (input && label) {
      label.textContent = input.value;
    }
  });
}

function balanceWeightGroup(changedId, ids) {
  if (balancing) return;
  balancing = true;

  const changedValue = sliderValue(changedId);
  const remaining = Math.max(0, 100 - changedValue);
  const others = ids.filter(id => id !== changedId);
  const otherSum = others.reduce((sum, id) => sum + sliderValue(id), 0);

  if (others.length === 1) {
    setSliderValue(others[0], remaining);
  } else if (otherSum === 0) {
    const each = remaining / others.length;
    others.forEach(id => setSliderValue(id, each));
  } else {
    others.forEach(id => {
      setSliderValue(id, remaining * sliderValue(id) / otherSum);
    });
  }

  const total = ids.reduce((sum, id) => sum + sliderValue(id), 0);
  const diff = 100 - total;
  if (diff !== 0) {
    const target = others[others.length - 1] || changedId;
    setSliderValue(target, sliderValue(target) + diff);
  }

  updateWeightLabels();
  balancing = false;
}

function rawFragility(p, weights) {
  return (
    weights.stranieri * num(p.rank_quota_stranieri_0_14) +
    weights.titolo * num(p.rank_quota_basso_titolo) +
    weights.famiglie * num(p.rank_quota_fam_numerose) +
    weights.abitazione * num(p.rank_residenti_per_abit)
  );
}

function rawScout(p, weights) {
  return (
    weights.bacinoNum * num(p.rank_bacino_scout) +
    weights.quotaScout * num(p.rank_quota_scout) +
    weights.densScout * num(p.rank_dens_scout)
  );
}

function updateEsagoniSource() {
  const source = map?.getSource?.("esagoni");
  if (!source || !esagoniData) return;

  source.setData(esagoniData);
}

function computeDynamicValues() {
  if (!esagoniData) return;

  const fragWeights = {
    stranieri: weight("wStranieri"),
    titolo: weight("wTitolo"),
    famiglie: weight("wFamiglie"),
    abitazione: weight("wAbitazione")
  };

  const fragDefaultWeights = {
    stranieri: 0.30,
    titolo: 0.30,
    famiglie: 0.20,
    abitazione: 0.20
  };

  const scoutWeights = {
    bacinoNum: weight("wBacinoNum"),
    quotaScout: weight("wQuotaScout"),
    densScout: weight("wDensScout")
  };

  const finalScoutWeight = weight("wScout");
  const finalFragWeight = weight("wFragilitaFinale");

  esagoniData.features.forEach(feature => {
    const p = feature.properties || {};
    const originalClass = p.classe_confronto_scout_fragilita;

    let scout = rawScout(p, scoutWeights);

    const fragDefaultRaw = rawFragility(p, fragDefaultWeights);
    const fragCurrentRaw = rawFragility(p, fragWeights);
    let fragility = num(p.indice_fragilita_educativa) + (fragCurrentRaw - fragDefaultRaw);

    if (originalClass === "non significativa") {
      scout = num(p.indice_scout_territoriale);
      fragility = num(p.indice_fragilita_educativa);
    }

    scout = clamp100(scout);
    fragility = clamp100(fragility);

    const priority = clamp100(finalScoutWeight * scout + finalFragWeight * fragility);

    p.indice_scout_dinamico = Number(scout.toFixed(2));
    p.indice_fragilita_dinamica = Number(fragility.toFixed(2));
    p.indice_priorita_dinamica = Number(priority.toFixed(2));
    p.contributo_scout_dinamico = Number((finalScoutWeight * scout).toFixed(2));
    p.contributo_fragilita_dinamico = Number((finalFragWeight * fragility).toFixed(2));

    if (originalClass === "non significativa") {
      p.classe_dinamica = "non significativa";
      return;
    }

    const scoutHigh = scout >= 60;
    const fragilityHigh = fragility >= 60;

    if (scoutHigh && fragilityHigh) {
      p.classe_dinamica = "priorità educativa scout";
    } else if (scoutHigh) {
      p.classe_dinamica = "bacino scout alto";
    } else if (fragilityHigh) {
      p.classe_dinamica = "fragilità educativa alta";
    } else {
      p.classe_dinamica = "priorità ordinaria";
    }
  });

  updateEsagoniSource();
  updateDynamicTop5();
  updateSelectedAreaProfile();
}

function updateDynamicTop5() {
  if (!esagoniData) return;

  const selected = esagoniData.features
    .filter(feature => feature.properties?.classe_dinamica === "priorità educativa scout")
    .sort((a, b) => {
      const pa = a.properties || {};
      const pb = b.properties || {};
      const fragDiff = num(pb.indice_fragilita_dinamica) - num(pa.indice_fragilita_dinamica);
      if (fragDiff !== 0) return fragDiff;
      return num(pb.indice_priorita_dinamica) - num(pa.indice_priorita_dinamica);
    })
    .slice(0, 5)
    .map((feature, index) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        rank_top5_dinamico: index + 1
      }
    }));

  top5Data = {
    type: "FeatureCollection",
    features: selected
  };

  if (map.getSource("top5")) {
    map.getSource("top5").setData(top5Data);
  }
}

function numericColorExpression(property, cfg = {}) {
  const max = cfg.max || 100;

  return [
    "case",
    ["any", ["==", ["get", property], null], ["==", ["get", property], ""]],
    "rgba(255,255,255,0)",
    [
      "interpolate",
      ["linear"],
      ["to-number", ["get", property], 0],
      0, "#f7f7f7",
      max * 0.2, "#d9f0d3",
      max * 0.4, "#addd8e",
      max * 0.6, "#78c679",
      max * 0.8, "#31a354",
      max, "#006837"
    ]
  ];
}

function classColorExpression() {
  return [
    "match",
    ["get", "classe_dinamica"],
    "priorità educativa scout", classVisibility["priorità educativa scout"] ? classColors["priorità educativa scout"] : "rgba(0,0,0,0)",
    "bacino scout alto", classVisibility["bacino scout alto"] ? classColors["bacino scout alto"] : "rgba(0,0,0,0)",
    "fragilità educativa alta", classVisibility["fragilità educativa alta"] ? classColors["fragilità educativa alta"] : "rgba(0,0,0,0)",
    "priorità ordinaria", classVisibility["priorità ordinaria"] ? classColors["priorità ordinaria"] : "rgba(0,0,0,0)",
    "non significativa", classVisibility["non significativa"] ? classColors["non significativa"] : "rgba(0,0,0,0)",
    "rgba(0,0,0,0)"
  ];
}


function isClassMode() {
  const modeEl = document.getElementById("mode");
  const modeValue = modeEl ? modeEl.value : currentMode;
  const cfg = modeConfig[modeValue] || modeConfig[currentMode] || {};
  return modeValue === "classe" || cfg.type === "class" || cfg.property === "classe_dinamica" || cfg.property === "classe_confronto_scout_fragilita";
}

function classOpacityExpression() {
  return [
    "match",
    ["get", "classe_dinamica"],
    "priorità educativa scout", classVisibility["priorità educativa scout"] ? 0.82 : 0,
    "bacino scout alto", classVisibility["bacino scout alto"] ? 0.78 : 0,
    "fragilità educativa alta", classVisibility["fragilità educativa alta"] ? 0.78 : 0,
    "priorità ordinaria", classVisibility["priorità ordinaria"] ? 0.72 : 0,
    "non significativa", classVisibility["non significativa"] ? 0.55 : 0,
    0
  ];
}

function numericOpacityExpression(property) {
  return [
    "case",
    ["any", ["==", ["get", property], null], ["==", ["get", property], ""]],
    0.05,
    0.72
  ];
}

function showPopup(lngLat, html, options = {}) {
  if (activePopup) {
    activePopup.remove();
  }

  activePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    ...options
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
}

function syncPanelStateClasses() {
  const panel = document.getElementById("panel");
  const profilePanel = document.getElementById("profile-panel");
  document.body.classList.toggle("panel-collapsed", !!panel?.classList.contains("is-collapsed"));
  document.body.classList.toggle("profile-collapsed", !!profilePanel?.classList.contains("is-collapsed"));
  document.body.classList.toggle(
    "profile-panel-visible",
    !!profilePanel?.classList.contains("is-open") && !profilePanel.classList.contains("is-collapsed")
  );
}

function setPanelCollapsed(collapsed) {
  const panel = document.getElementById("panel");
  if (!panel) return;
  panel.classList.toggle("is-collapsed", collapsed);
  syncPanelStateClasses();
}

function setProfileCollapsed(collapsed) {
  const profilePanel = document.getElementById("profile-panel");
  if (!profilePanel || !profilePanel.classList.contains("is-open")) return;
  profilePanel.classList.toggle("is-collapsed", collapsed);
  syncPanelStateClasses();
}

function openProfilePanel() {
  const profilePanel = document.getElementById("profile-panel");
  if (!profilePanel) return;
  profilePanel.classList.add("is-open");
  profilePanel.classList.remove("is-collapsed");
  syncPanelStateClasses();
}

function firstTextValue(properties, keys) {
  for (const key of keys) {
    const value = properties?.[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function comunePrevalente(properties) {
  return firstTextValue(properties, [
    "comune_prevalente",
    "Comune_prevalente",
    "COMUNE_PREVALENTE",
    "comune",
    "Comune",
    "COMUNE"
  ]);
}

function comuniInteressati(properties) {
  const raw = firstTextValue(properties, [
    "comuni_interessati",
    "comuni_esagoni",
    "comuni_esagono",
    "comuni",
    "Comuni",
    "COMUNI"
  ]);
  if (!raw) return "";
  return raw
    .split(/[;,|]/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index)
    .join(", ");
}

function areaDescrittiva(properties) {
  return firstTextValue(properties, [
    "area_descrittiva",
    "area_descr",
    "Area_descrittiva",
    "AREA_DESCRITTIVA"
  ]);
}


function fieldValue(properties, key) {
  const value = properties?.[key];
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) return 0;
  return Number(value);
}

const profileAxes = [
  {
    key: "pop_2023",
    label: "Popolazione stimata",
    shortLabel: "Popolazione",
    group: "demo",
    scale: "robust",
    value: p => fieldValue(p, "pop_2023"),
    display: p => fmt(fieldValue(p, "pop_2023"), 0)
  },
  {
    key: "giovani_0_14_2023",
    label: "Residenti 0-14",
    shortLabel: "0-14",
    group: "demo",
    scale: "robust",
    value: p => fieldValue(p, "giovani_0_14_2023"),
    display: p => fmt(fieldValue(p, "giovani_0_14_2023"), 0)
  },
  {
    key: "bacino_scout_proxy",
    label: "Bacino scout proxy",
    shortLabel: "Bacino scout",
    group: "scout",
    scale: "robust",
    value: p => fieldValue(p, "bacino_scout_proxy"),
    display: p => fmt(fieldValue(p, "bacino_scout_proxy"), 0)
  },
  {
    key: "dens_pop_2023",
    label: "Densità popolazione",
    shortLabel: "Densità",
    group: "abitare",
    scale: "robust",
    value: p => fieldValue(p, "dens_pop_2023"),
    display: p => `${fmt(fieldValue(p, "dens_pop_2023"), 0)} ab/km²`
  },
  {
    key: "quota_stranieri_0_14",
    label: "Stranieri 0-14 su residenti 0-14",
    shortLabel: "Stranieri 0-14",
    group: "frag",
    scale: "percent",
    value: p => fieldValue(p, "quota_stranieri_0_14"),
    display: p => `${fmt(fieldValue(p, "quota_stranieri_0_14"), 1)}%`
  },
  {
    key: "quota_basso_titolo",
    label: "Basso titolo di studio",
    shortLabel: "Titolo basso",
    group: "frag",
    scale: "percent",
    value: p => fieldValue(p, "quota_basso_titolo"),
    display: p => `${fmt(fieldValue(p, "quota_basso_titolo"), 1)}%`
  },
  {
    key: "quota_fam_numerose",
    label: "Famiglie numerose su famiglie totali",
    shortLabel: "Famiglie\nnumerose",
    group: "frag",
    scale: "percent",
    value: p => fieldValue(p, "quota_fam_numerose"),
    display: p => `${fmt(fieldValue(p, "quota_fam_numerose"), 1)}%`
  },
  {
    key: "residenti_per_abit",
    label: "Residenti per abitazione",
    shortLabel: "Res./abitazione",
    group: "abitare",
    scale: "robust",
    value: p => fieldValue(p, "residenti_per_abit"),
    display: p => fmt(fieldValue(p, "residenti_per_abit"), 2)
  }
];

function computeProfileScales() {
  if (!esagoniData) return;

  profileScales = {};
  profileAxes.forEach(axis => {
    if (axis.scale === "percent") {
      profileScales[axis.key] = { min: 0, max: 100 };
      return;
    }

    const values = esagoniData.features
      .map(feature => axis.value(feature.properties || {}))
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);

    if (!values.length) {
      profileScales[axis.key] = { min: 0, max: 1 };
      return;
    }

    const p95Index = Math.min(values.length - 1, Math.floor(values.length * 0.95));
    // Scala robusta per il profilo visuale: il p95 evita che pochi outlier
    // comprimano tutto il grafico; il pavimento al 25% del massimo mantiene
    // leggibili anche assi con distribuzioni molto sbilanciate.
    const max = Math.max(values[p95Index], values[values.length - 1] * 0.25, 1);
    profileScales[axis.key] = { min: 0, max };
  });
}

function normalizeProfileAxis(axis, properties) {
  const raw = axis.value(properties);
  const scale = profileScales[axis.key] || { min: 0, max: 100 };
  const normalized = ((raw - scale.min) / (scale.max - scale.min)) * 100;
  return clamp100(normalized);
}

function profileFeatureByHexId(hexId) {
  if (!hexId || !esagoniData) return null;
  return esagoniData.features.find(feature => feature.properties?.hex_id === hexId) || null;
}

function selectedProfileProperties() {
  return profileFeatureByHexId(selectedHexId)?.properties || null;
}

function profileGroupColor(group) {
  if (group === "frag") return "#8073ac";
  if (group === "demo") return "#fdae61";
  if (group === "abitare") return "#6a994e";
  return "#4b2e83";
}

function polarPoint(cx, cy, radius, angle) {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function svgMultilineText(text, x, y, anchor, className, lineHeight = 13) {
  const lines = String(text ?? "").split("\n");
  const offset = -((lines.length - 1) * lineHeight) / 2;
  const tspans = lines.map((line, index) => {
    const dy = index === 0 ? offset : lineHeight;
    return `<tspan x="${x}" dy="${dy}">${escapeHtml(line)}</tspan>`;
  }).join("");

  return `<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}">${tspans}</text>`;
}

function profileSvg(properties) {
  const width = 440;
  const height = 340;
  const cx = 220;
  const cy = 166;
  const maxRadius = 104;
  const labelRadius = 148;

  const points = profileAxes.map((axis, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / profileAxes.length);
    const normalized = normalizeProfileAxis(axis, properties);
    const point = polarPoint(cx, cy, maxRadius * normalized / 100, angle);
    const labelPoint = polarPoint(cx, cy, labelRadius, angle);
    const dotPoint = polarPoint(cx, cy, maxRadius, angle);
    return { axis, angle, normalized, point, labelPoint, dotPoint };
  });

  const polygon = points.map(item => `${item.point.x.toFixed(1)},${item.point.y.toFixed(1)}`).join(" ");

  const grid = [25, 50, 75, 100].map(level => {
    const r = maxRadius * level / 100;
    const gridPoints = profileAxes.map((_, index) => {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / profileAxes.length);
      const point = polarPoint(cx, cy, r, angle);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    }).join(" ");
    return `<polygon class="profile-grid-line" points="${gridPoints}"></polygon>`;
  }).join("");

  const axes = points.map(item => `
    <line class="profile-axis-line" x1="${cx}" y1="${cy}" x2="${item.dotPoint.x.toFixed(1)}" y2="${item.dotPoint.y.toFixed(1)}"></line>
  `).join("");

  const dots = points.map(item => `
    <circle class="profile-point" cx="${item.point.x.toFixed(1)}" cy="${item.point.y.toFixed(1)}" r="4.2" style="fill:${profileGroupColor(item.axis.group)}"></circle>
  `).join("");

  const labels = points.map(item => {
    const anchor = item.labelPoint.x < cx - 12 ? "end" : item.labelPoint.x > cx + 12 ? "start" : "middle";
    const labelX = item.labelPoint.x.toFixed(1);
    const labelY = (item.labelPoint.y - 6).toFixed(1);
    const valueY = (item.labelPoint.y + 20).toFixed(1);
    return `
      ${svgMultilineText(item.axis.shortLabel, labelX, labelY, anchor, "profile-axis-label", 12)}
      ${svgMultilineText(item.axis.display(properties), labelX, valueY, anchor, "profile-axis-value", 11)}
    `;
  }).join("");

  const centerScout = fmt(properties.indice_scout_dinamico ?? properties.indice_scout_territoriale, 0);
  const centerFrag = fmt(properties.indice_fragilita_dinamica ?? properties.indice_fragilita_educativa, 0);

  return `
    <div class="profile-svg-wrap">
      <svg class="profile-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Impronta educativa dell'area selezionata">
        ${grid}
        ${axes}
        <polygon class="profile-polygon" points="${polygon}"></polygon>
        ${dots}
        <circle cx="${cx}" cy="${cy}" r="25" fill="rgba(255,255,255,0.88)" stroke="rgba(75,46,131,0.28)" stroke-width="1"></circle>
        <text x="${cx}" y="${cy - 5}" text-anchor="middle" class="profile-center-label">Scout ${centerScout}</text>
        <text x="${cx}" y="${cy + 11}" text-anchor="middle" class="profile-center-label">Frag. ${centerFrag}</text>
        ${labels}
      </svg>
    </div>
  `;
}

function profileInterpretation(properties) {
  const scout = num(properties.indice_scout_dinamico);
  const fragility = num(properties.indice_fragilita_dinamica);

  if (properties.classe_dinamica === "priorità educativa scout") {
    return "L’area combina un bacino scout alto con una fragilità educativa alta: è una zona da leggere con particolare attenzione progettuale.";
  }
  if (properties.classe_dinamica === "bacino scout alto") {
    return "L’area mostra soprattutto un bacino scout territoriale alto: molti bambini e ragazzi sono potenzialmente raggiungibili.";
  }
  if (properties.classe_dinamica === "fragilità educativa alta") {
    return "L’area mostra soprattutto una fragilità educativa alta: la proposta educativa può essere significativa, anche se il bacino scout stimato è meno intenso.";
  }
  if (properties.classe_dinamica === "non significativa") {
    return "L’area ha dati troppo deboli o poco significativi per una lettura interpretativa robusta.";
  }

  if (scout >= 50 || fragility >= 50) {
    return "L’area presenta alcuni segnali territoriali da osservare, senza rientrare nelle classi alte del modello.";
  }
  return "L’area non emerge tra le priorità del modello, ma può comunque essere letta nel contesto locale.";
}

function renderAreaProfile(properties, options = {}) {
  const container = document.getElementById("profile-content");
  const empty = document.querySelector("#area-profile .profile-empty");
  const panel = document.getElementById("profile-panel");
  if (!container) return;

  if (!properties) {
    container.classList.add("is-empty");
    container.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (panel) panel.classList.remove("is-open", "is-collapsed");
    syncPanelStateClasses();
    return;
  }

  if (options.open) {
    openProfilePanel();
  } else if (panel) {
    panel.classList.add("is-open");
    syncPanelStateClasses();
  }
  if (empty) empty.style.display = "none";
  container.classList.remove("is-empty");

  const comune = comunePrevalente(properties);
  const comuni = comuniInteressati(properties);
  const area = areaDescrittiva(properties);
  const title = area || comune || properties.hex_id || "Area selezionata";
  const geographyRows = [
    comune ? `<span>Comune prevalente</span><span>${escapeHtml(comune)}</span>` : "",
    comuni ? `<span>Comuni interessati</span><span>${escapeHtml(comuni)}</span>` : "",
    area ? `<span>Area descrittiva</span><span>${escapeHtml(area)}</span>` : ""
  ].filter(Boolean).join("");
  const distance = properties.distanza_gruppo_scout_km !== undefined && properties.distanza_gruppo_scout_km !== null
    ? `${fmt(properties.distanza_gruppo_scout_km, 2)} km in linea d’aria`
    : "n.d.";

  container.innerHTML = `
    <div class="profile-card-title">${escapeHtml(title)}</div>
    <div class="profile-class">${escapeHtml(properties.classe_dinamica || properties.classe_confronto_scout_fragilita || "n.d.")}</div>

    ${geographyRows ? `<div class="profile-geography">${geographyRows}</div>` : ""}

    <div class="profile-kpi-grid">
      <div class="profile-kpi"><strong>${fmt(properties.indice_priorita_dinamica ?? properties.indice_priorita_educativa_scout, 0)}</strong><span>priorità</span></div>
      <div class="profile-kpi"><strong>${fmt(properties.indice_scout_dinamico ?? properties.indice_scout_territoriale, 0)}</strong><span>bacino scout</span></div>
      <div class="profile-kpi"><strong>${fmt(properties.indice_fragilita_dinamica ?? properties.indice_fragilita_educativa, 0)}</strong><span>fragilità</span></div>
    </div>

    <div class="profile-summary">${profileInterpretation(properties)}</div>

    <div class="profile-legend-mini">
      <span class="demo">demografia</span>
      <span>bacino scout</span>
      <span class="frag">fragilità</span>
      <span class="abitare">abitare/densità</span>
    </div>

    ${profileSvg(properties)}

    <div class="profile-section-title">Dati reali stimati nell’esagono</div>
    <div class="profile-metrics">
      <span>Popolazione stimata</span><span>${fmt(properties.pop_2023, 0)}</span>
      <span>Residenti 0-14<br><small>quota sulla popolazione</small></span><span>${fmt(properties.giovani_0_14_2023, 0)} (${fmt(properties.quota_0_14_2023, 1)}%)</span>
      <span>Bacino scout proxy<br><small>quota sulla popolazione</small></span><span>${fmt(properties.bacino_scout_proxy, 0)} (${fmt(properties.quota_scout_proxy, 1)}%)</span>
      <span>Stranieri 0-14<br><small>quota sui residenti 0-14</small></span><span>${fmt(properties.stranieri_0_14_2023, 0)} (${fmt(properties.quota_stranieri_0_14, 1)}%)</span>
      <span>Basso titolo di studio<br><small>quota sulla popolazione di riferimento</small></span><span>${fmt(properties.quota_basso_titolo, 1)}%</span>
      <span>Famiglie numerose<br><small>quota sulle famiglie</small></span><span>${fmt(properties.fam_numerose, 0)} (${fmt(properties.quota_fam_numerose, 1)}%)</span>
      <span>Residenti per abitazione</span><span>${fmt(properties.residenti_per_abit, 2)}</span>
      <span>Densità popolazione</span><span>${fmt(properties.dens_pop_2023, 0)} ab/km²</span>
      <span>Gruppo scout più vicino</span><span>${properties.gruppo_scout_piu_vicino || "n.d."}</span>
      <span>Distanza dal gruppo</span><span>${distance}</span>
    </div>

    <p class="profile-note">
      Le percentuali hanno denominatori diversi, indicati nella scheda. La forma usa una normalizzazione visuale
      per rendere confrontabili grandezze diverse; i numeri riportati sono valori reali stimati per l’esagono.
    </p>
  `;
}

function updateSelectedAreaProfile() {
  renderAreaProfile(selectedProfileProperties());
}

function selectAreaProfile(properties, options = {}) {
  selectedHexId = properties?.hex_id || null;
  if (options.open) {
    renderAreaProfile(selectedProfileProperties(), { open: true });
  } else {
    updateSelectedAreaProfile();
  }
}


function popupHtml(p) {
  const title = p.hex_id || "Esagono";
  const className = p.classe_dinamica || p.classe_confronto_scout_fragilita || "n.d.";
  const comune = comunePrevalente(p);
  const area = areaDescrittiva(p);
  const place = [comune, area].filter(Boolean).join(" / ");

  return `
    <div class="popup-compact">
      <div class="popup-title">${escapeHtml(title)}</div>
      <div class="popup-class">${escapeHtml(className)}</div>
      ${place ? `<div class="popup-place">${escapeHtml(place)}</div>` : ""}
      <button type="button" class="popup-action" data-open-profile="true">Apri scheda</button>
    </div>
  `;
}

function groupPopupHtml(p) {
  const name = p.nome || p.Nome || p.gruppo || p.Gruppo || p.name || "Gruppo scout";
  const address = p.indirizzo || p.Indirizzo || "";
  const city = p.comune || p.Comune || p.citta || p.Citta || "";
  const zone = p.zona || "";
  const site = p.sito_web || p.url || p.sito || "";
  const sourceNote = p.precisione_posizionamento === "indicativa_da_indirizzo"
    ? '<div class="popup-note">Posizione indicativa da indirizzo ufficiale</div>'
    : "";
  const title = site
    ? `<a href="${site}" target="_blank" rel="noopener noreferrer">${name}</a>`
    : name;
  const place = [address, city].filter(Boolean).join(", ");

  return `
    <div class="popup-title">${title}</div>
    ${zone ? `<div class="popup-zone">Zona: ${zone}</div>` : ""}
    ${place ? `<div>${place}</div>` : ""}
    ${sourceNote}
    ${site ? `<div class="popup-link"><a href="${site}" target="_blank" rel="noopener noreferrer">Apri sito del gruppo</a></div>` : ""}
  `;
}

function recursiveCoords(coords, bounds) {
  if (typeof coords[0] === "number") {
    bounds.extend(coords);
  } else {
    coords.forEach(item => recursiveCoords(item, bounds));
  }
}

function fitToGeojson(geojson) {
  const bounds = new maplibregl.LngLatBounds();
  geojson.features.forEach(feature => {
    if (feature.geometry?.coordinates) {
      recursiveCoords(feature.geometry.coordinates, bounds);
    }
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 40, duration: 0 });
  }
}

function updateMapMode(mode) {
  currentMode = mode;
  const cfg = modeConfig[mode];

  if (!map.getLayer("esagoni-fill")) return;

  if (mode === "classe") {
    map.setPaintProperty("esagoni-fill", "fill-color", classColorExpression());
    map.setPaintProperty("esagoni-fill", "fill-opacity", classOpacityExpression());
    renderClassLegend();
  } else {
    map.setPaintProperty("esagoni-fill", "fill-color", numericColorExpression(cfg.property, cfg));
    map.setPaintProperty("esagoni-fill", "fill-opacity", numericOpacityExpression(cfg.property));
    renderNumericLegend(cfg.title);
  }

  setWeightBlocksVisibility(mode);
}

function renderClassLegend() {
  const legend = document.getElementById("legend");

  const classRows = [
    ["priorità educativa scout", classColors["priorità educativa scout"]],
    ["bacino scout alto", classColors["bacino scout alto"]],
    ["fragilità educativa alta", classColors["fragilità educativa alta"]],
    ["priorità ordinaria", classColors["priorità ordinaria"]],
    ["non significativa", classColors["non significativa"]]
  ];

  const html = classRows.map(([label, color]) => `
    <label class="legend-toggle-row">
      <span class="legend-swatch legend-swatch-class" style="background:${color}; border:1px solid rgba(0,0,0,0.35); width:18px; height:18px; display:inline-block; flex:0 0 18px;"></span>
      <input type="checkbox" class="legend-class-toggle" data-class-name="${label}" ${classVisibility[label] ? "checked" : ""}>
      <span>${label}</span>
    </label>
  `).join("");

  legend.innerHTML = `
    <div class="legend-title">Legenda</div>
    ${html}
    <hr class="legend-sep">
  `;

  appendLayerLegendRows();

  document.querySelectorAll(".legend-class-toggle").forEach(el => {
    el.addEventListener("change", (ev) => {
      const className = ev.target.dataset.className;
      classVisibility[className] = !!ev.target.checked;

      if (isClassMode()) {
        map.setPaintProperty("esagoni-fill", "fill-color", classColorExpression());
        map.setPaintProperty("esagoni-fill", "fill-opacity", classOpacityExpression());
        if (typeof map.triggerRepaint === "function") map.triggerRepaint();
      }
    });
  });
}

function legendClassRow(className) {
  return `
    <div class="legend-row">
      <span class="swatch" style="background:${classColors[className]}"></span>
      <span>${className.charAt(0).toUpperCase() + className.slice(1)}</span>
    </div>
  `;
}

function renderNumericLegend(title) {
  const legend = document.getElementById("legend");
  const cfg = modeConfig[currentMode] || {};
  const max = cfg.max || 100;
  const scaleLabel = cfg.numericScale === "absolute"
    ? `0 → ${max} stimati`
    : "0 → 100";

  legend.innerHTML = `
    <div class="legend-title">${title}</div>
    <label class="legend-toggle-row">
      <span class="gradient-swatch"></span>
      <input type="checkbox" class="legend-layer-toggle" data-layer-name="esagoni" ${esagoniVisible ? "checked" : ""}>
      <span>${scaleLabel}</span>
    </label>
  `;
  appendLayerLegendRows();
}

function appendLayerLegendRows() {
  const legend = document.getElementById("legend");
  const rows = [];

  rows.push(`
    <label class="legend-toggle-row">
      <span class="legend-swatch" style="background:#efe48c; border:1px solid rgba(0,0,0,0.35); width:18px; height:18px; display:inline-block; flex:0 0 18px;"></span>
      <input type="checkbox" class="legend-layer-toggle" data-layer-name="top5" ${top5Visible ? "checked" : ""}>
      <span>5 aree prioritarie selezionate</span>
    </label>
  `);

  rows.push(`
    <label class="legend-toggle-row">
      <span class="legend-swatch" style="background:#6a3d9a; border:1px solid rgba(0,0,0,0.35); width:18px; height:18px; display:inline-block; flex:0 0 18px; border-radius:50%;"></span>
      <input type="checkbox" class="legend-layer-toggle" data-layer-name="gruppi" ${gruppiVisible ? "checked" : ""}>
      <span>Gruppi AGESCI zona Varese</span>
    </label>
  `);

  rows.push(`
    <label class="legend-toggle-row">
      <span class="legend-swatch" style="background:#0f766e; border:1px solid rgba(0,0,0,0.35); width:18px; height:18px; display:inline-block; flex:0 0 18px; border-radius:50%;"></span>
      <input type="checkbox" class="legend-layer-toggle" data-layer-name="gruppiVicine" ${gruppiVicineVisible ? "checked" : ""}>
      <span>Gruppi AGESCI zone vicine</span>
    </label>
  `);

  legend.innerHTML += rows.join("");

  document.querySelectorAll(".legend-layer-toggle").forEach(el => {
    el.addEventListener("change", (ev) => {
      const layerName = ev.target.dataset.layerName;
      const checked = !!ev.target.checked;

      if (layerName === "esagoni") {
        esagoniVisible = checked;
        setEsagoniVisibility();
      } else if (layerName === "top5") {
        top5Visible = checked;
        setTop5Visibility();
      } else if (layerName === "gruppi") {
        gruppiVisible = checked;
        setGruppiVisibility();
      } else if (layerName === "gruppiVicine") {
        gruppiVicineVisible = checked;
        setGruppiVicineVisibility();
      }
    });
  });
}

function renderLegendForCurrentMode() {
  if (currentMode === "classe") {
    renderClassLegend();
  } else {
    renderNumericLegend(modeConfig[currentMode].title);
  }
}

function applyOverlayVisibility() {
  const esagoniVisibility = esagoniVisible ? "visible" : "none";
  ["esagoni-fill", "esagoni-line"].forEach(layerId => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", esagoniVisibility);
    }
  });

  const top5Visibility = top5Visible ? "visible" : "none";
  ["top5-fill", "top5-line"].forEach(layerId => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", top5Visibility);
    }
  });

  const gruppiVisibility = gruppiVisible ? "visible" : "none";
  ["gruppi-circle"].forEach(layerId => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", gruppiVisibility);
    }
  });

  const gruppiVicineVisibility = gruppiVicineVisible ? "visible" : "none";
  ["gruppi-vicini-circle"].forEach(layerId => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", gruppiVicineVisibility);
    }
  });
}

function setTop5Visibility() {
  applyOverlayVisibility();
  if (typeof map.triggerRepaint === "function") map.triggerRepaint();
}

function setGruppiVisibility() {
  applyOverlayVisibility();
  if (typeof map.triggerRepaint === "function") map.triggerRepaint();
}

function setGruppiVicineVisibility() {
  applyOverlayVisibility();
  if (typeof map.triggerRepaint === "function") map.triggerRepaint();
}

function setEsagoniVisibility() {
  applyOverlayVisibility();
  if (typeof map.triggerRepaint === "function") map.triggerRepaint();
}

function setWeightBlocksVisibility(mode) {
  const visibleBlocksByMode = {
    classe: ["fragilita", "scout"],
    priorita_dinamica: ["fragilita", "scout", "priorita"],
    fragilita_dinamica: ["fragilita"],
    scout: ["scout"]
  };

  const visibleBlocks = visibleBlocksByMode[mode] || [];
  document.querySelectorAll(".weights-block").forEach(block => {
    const type = block.dataset.weightBlock;
    block.classList.toggle("is-hidden", !visibleBlocks.includes(type));
  });

  const panel = document.getElementById("weights-panel");
  if (panel) {
    panel.classList.toggle("is-hidden", visibleBlocks.length === 0);
  }
}

function setBasemap(key) {
  Object.entries(basemaps).forEach(([id, def]) => {
    if (!map.getLayer(def.layerId)) return;
    map.setLayoutProperty(def.layerId, "visibility", id === key ? "visible" : "none");
  });
}

function resetWeights() {
  Object.entries(defaultWeights).forEach(([id, value]) => {
    setSliderValue(id, value);
  });
  updateWeightLabels();
  computeDynamicValues();
  updateMapMode(currentMode);
}

function attachWeightListeners() {
  Object.values(weightGroups).forEach(ids => {
    ids.forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;

      input.addEventListener("input", () => {
        balanceWeightGroup(id, ids);
        computeDynamicValues();
        renderLegendForCurrentMode();
      });
    });
  });

  const reset = document.getElementById("resetWeights");
  if (reset) {
    reset.addEventListener("click", resetWeights);
  }

  updateWeightLabels();
}

function attachControlListeners() {
  const modeSelect = document.getElementById("mode");
  if (modeSelect) {
    modeSelect.addEventListener("change", event => {
      updateMapMode(event.target.value);
    });
  }

  const basemapSelect = document.getElementById("basemap-select");
  if (basemapSelect) {
    basemapSelect.addEventListener("change", event => {
      setBasemap(event.target.value);
    });
  }

  const panelCollapse = document.getElementById("panel-collapse");
  if (panelCollapse) {
    panelCollapse.addEventListener("click", () => setPanelCollapsed(true));
  }

  const panelTab = document.getElementById("panel-tab");
  if (panelTab) {
    panelTab.addEventListener("click", () => setPanelCollapsed(false));
  }

  const profileMinimize = document.getElementById("profile-minimize");
  if (profileMinimize) {
    profileMinimize.addEventListener("click", () => setProfileCollapsed(true));
  }

  const profileTab = document.getElementById("profile-tab");
  if (profileTab) {
    profileTab.addEventListener("click", () => setProfileCollapsed(false));
  }

  const profileClose = document.getElementById("profile-close");
  if (profileClose) {
    profileClose.addEventListener("click", () => {
      selectedHexId = null;
      renderAreaProfile(null);
    });
  }

  document.addEventListener("click", event => {
    const target = event.target?.closest?.("[data-open-profile]");
    if (!target) return;
    event.preventDefault();
    if (selectedHexId) {
      renderAreaProfile(selectedProfileProperties(), { open: true });
    } else {
      openProfilePanel();
    }
    if (activePopup) activePopup.remove();
  });
}


function addMapLayers() {
  map.addSource("esagoni", {
    type: "geojson",
    data: esagoniData
  });

  map.addSource("top5", {
    type: "geojson",
    data: top5Data
  });

  map.addSource("gruppi", {
    type: "geojson",
    data: gruppiData
  });

  map.addSource("gruppi-vicini", {
    type: "geojson",
    data: gruppiVicineData
  });

  map.addLayer({
    id: "esagoni-fill",
    type: "fill",
    source: "esagoni",
    paint: {
      "fill-color": classColorExpression(),
      "fill-opacity": classOpacityExpression()
    }
  });

  map.addLayer({
    id: "esagoni-line",
    type: "line",
    source: "esagoni",
    paint: {
      "line-color": "rgba(80,80,80,0.35)",
      "line-width": 0.45
    }
  });

  map.addLayer({
    id: "top5-fill",
    type: "fill",
    source: "top5",
    paint: {
      "fill-color": "#ffd400",
      "fill-opacity": 0.32
    }
  });

  map.addLayer({
    id: "top5-line",
    type: "line",
    source: "top5",
    paint: {
      "line-color": "#111111",
      "line-width": 2.2
    }
  });

  map.addLayer({
    id: "gruppi-circle",
    type: "circle",
    source: "gruppi",
    paint: {
      "circle-radius": 7,
      "circle-color": "#6a3d9a",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    }
  });

  map.addLayer({
    id: "gruppi-vicini-circle",
    type: "circle",
    source: "gruppi-vicini",
    paint: {
      "circle-radius": 6,
      "circle-color": "#0f766e",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    }
  });

  map.on("click", "esagoni-fill", event => {
    const features = map.queryRenderedFeatures(event.point, { layers: ["gruppi-circle"] });
    if (features.length > 0) return;

    const feature = event.features?.[0];
    if (!feature) return;

    selectAreaProfile(feature.properties, { open: true });
    showPopup(event.lngLat, popupHtml(feature.properties));
  });

  map.on("click", "gruppi-circle", event => {
    const feature = event.features?.[0];
    if (!feature) return;

    showPopup(
      feature.geometry.coordinates.slice(),
      groupPopupHtml(feature.properties || {}),
      { anchor: "top", offset: [0, 18] }
    );
  });

  map.on("click", "gruppi-vicini-circle", event => {
    const feature = event.features?.[0];
    if (!feature) return;

    showPopup(
      feature.geometry.coordinates.slice(),
      groupPopupHtml(feature.properties || {}),
      { anchor: "top", offset: [0, 18] }
    );
  });

  ["esagoni-fill", "gruppi-circle", "gruppi-vicini-circle"].forEach(layerId => {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  });
}

function addInfoTipToElement(element, text) {
  if (!element || element.querySelector(".info-tip")) return;

  const tip = document.createElement("span");
  tip.className = "info-tip";
  tip.textContent = "?";
  tip.setAttribute("data-tip", text);
  element.appendChild(tip);
}

function addInfoTipByText(selector, textToFind, tipText) {
  document.querySelectorAll(selector).forEach(element => {
    const cleanText = element.textContent.replace("?", "").trim();
    if (cleanText.includes(textToFind)) {
      addInfoTipToElement(element, tipText);
    }
  });
}

function attachIndicatorTooltips() {
  addInfoTipToElement(
    document.querySelector('label[for="mode"]'),
    "Permette di scegliere quale variabile colorare sulla mappa: classi interpretative, indici aggregati dinamici o singole componenti normalizzate da 0 a 100."
  );

  addInfoTipByText(
    ".weights-block h3",
    "Fragilità educativa",
    "Indice composito costruito da quattro indicatori territoriali: minori stranieri 0-14, basso titolo di studio, famiglie numerose e residenti per abitazione. È un indicatore di contesto: non misura il disagio delle singole famiglie."
  );

  addInfoTipByText(
    ".weights-block h3",
    "Bacino scout territoriale",
    "Indice composito che prova a stimare quanto un esagono sia rilevante come possibile bacino scout. Combina quantità di bambini/ragazzi, quota sulla popolazione totale e densità territoriale."
  );

  addInfoTipByText(
    ".weights-block h3",
    "Priorità educativa scout",
    "Indice finale che combina bacino scout territoriale e fragilità educativa. Serve a individuare aree in cui la presenza educativa scout potrebbe essere particolarmente significativa."
  );

  addInfoTipByText(
    ".slider-row span",
    "Quota stranieri 0-14",
    "Quota di residenti stranieri tra 0 e 14 anni sul totale dei residenti 0-14; nella mappa degli indicatori viene mostrata solo per celle significative. La mappa “Stranieri 0-14, numero stimato” mostra invece il valore assoluto stimato. Non indica fragilità in sé; segnala territori dove possono essere più rilevanti temi di inclusione, accesso alle opportunità educative e reti di prossimità."
  );

  addInfoTipByText(
    ".slider-row span",
    "Basso titolo di studio",
    "Quota di popolazione adulta con titolo di studio basso. È usata come indicatore del contesto socio-culturale del territorio e delle opportunità educative e formative disponibili."
  );

  addInfoTipByText(
    ".slider-row span",
    "Famiglie numerose",
    "Quota di famiglie con molti componenti sul totale delle famiglie residenti. Non indica automaticamente fragilità: segnala piuttosto territori dove può essere più alta la domanda di spazi, servizi e proposte educative accessibili."
  );

  addInfoTipByText(
    ".slider-row span",
    "Residenti per abitazione",
    "Numero medio di residenti per abitazione occupata. È un indicatore abitativo: misura quante persone vivono mediamente in una casa occupata e può segnalare maggiore intensità o pressione abitativa."
  );

  addInfoTipByText(
    ".slider-row span",
    "Numero ragazzi / bacino potenziale",
    "Valore normalizzato del numero assoluto di bambini, ragazzi e adolescenti presenti nell'esagono. Premia gli esagoni dove il numero potenziale di destinatari della proposta scout è più alto."
  );

  addInfoTipByText(
    ".slider-row span",
    "Quota scout potenziale",
    "Quota della popolazione in età vicina all'esperienza scout rispetto alla popolazione totale dell'esagono. Premia i territori dove bambini e ragazzi pesano di più sulla popolazione residente."
  );

  addInfoTipByText(
    ".slider-row span",
    "Densità scout potenziale",
    "Densità territoriale del bacino scout potenziale, cioè concentrazione di bambini e ragazzi nello spazio. Premia gli esagoni dove il bacino potenziale è più concentrato territorialmente."
  );
}

function setupGlobalTooltip() {
  let tooltip = document.getElementById("global-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "global-tooltip";
    document.body.appendChild(tooltip);
  }

  function positionTooltip(event) {
    const padding = 14;
    const offsetX = 18;
    const offsetY = 14;

    tooltip.style.display = "block";
    const rect = tooltip.getBoundingClientRect();

    let left = event.clientX + offsetX;
    let top = event.clientY + offsetY;

    if (left + rect.width + padding > window.innerWidth) {
      left = event.clientX - rect.width - offsetX;
    }

    if (top + rect.height + padding > window.innerHeight) {
      top = event.clientY - rect.height - offsetY;
    }

    tooltip.style.left = `${Math.max(padding, left)}px`;
    tooltip.style.top = `${Math.max(padding, top)}px`;
  }

  document.querySelectorAll(".info-tip").forEach(tip => {
    tip.addEventListener("mouseenter", event => {
      const text = tip.getAttribute("data-tip");
      if (!text) return;
      tooltip.textContent = text;
      positionTooltip(event);
    });

    tip.addEventListener("mousemove", positionTooltip);

    tip.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });
}

async function loadData() {
  const [esagoni, gruppi, gruppiVicine, top5] = await Promise.all([
    fetch("data/esagoni.geojson").then(response => response.json()),
    fetch("data/gruppi_scout.geojson").then(response => response.json()),
    fetch("data/gruppi_scout_zone_vicine.geojson").then(response => response.json()),
    fetch("data/top5.geojson").then(response => response.json())
  ]);

  esagoniData = esagoni;
  gruppiData = gruppi;
  gruppiVicineData = gruppiVicine;
  top5Data = top5;

  computeProfileScales();
  computeDynamicValues();
  renderAreaProfile(null);
}

async function init() {
  attachControlListeners();
  attachWeightListeners();
  attachIndicatorTooltips();
  setupGlobalTooltip();
  setWeightBlocksVisibility(currentMode);

  await loadData();

  addMapLayers();
  updateMapMode(currentMode);
  applyOverlayVisibility();
  fitToGeojson(esagoniData);
}

map.on("load", () => {
  init().catch(error => {
    console.error("Errore durante l'inizializzazione della mappa:", error);
  });
});
