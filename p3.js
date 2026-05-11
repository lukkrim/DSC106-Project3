import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';

const DATA_URL = 'terra_fire_california_2000_2025_windows/data.csv';
const STATES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const COUNTIES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';
const CALIFORNIA_FIPS = '06';

// Southern California cities & regional labels for geographic context.
const CITY_LABELS = [
    { name: 'Los Angeles', lat: 34.05, lon: -118.25, anchor: 'start', dx: 6 },
    { name: 'San Diego', lat: 32.72, lon: -117.16, anchor: 'start', dx: 6 },
    { name: 'Santa Barbara', lat: 34.42, lon: -119.70, anchor: 'end', dx: -6 },
    { name: 'Bakersfield', lat: 35.37, lon: -119.02, anchor: 'start', dx: 6 },
    { name: 'Palm Springs', lat: 33.83, lon: -116.55, anchor: 'start', dx: 6 },
    { name: 'Riverside', lat: 33.98, lon: -117.38, anchor: 'start', dx: 6 },
];

const REGION_LABELS = [
    { name: 'PACIFIC OCEAN', lat: 32.8, lon: -121.0 },
    { name: 'Mojave Desert', lat: 35.0, lon: -116.4 },
    { name: 'Southern Sierra', lat: 36.0, lon: -118.3 },
];

// ============================================================
// Load data
// ============================================================

const rawFires = await d3.csv(DATA_URL, (row) => ({
    ...row,
    latitude: +row.latitude,
    longitude: +row.longitude,
    brightness: +row.brightness_temp_channel_21_22_K,
    frp: +row.fire_radiative_power_MW,
    confidence: +row.detection_confidence_percent,
    date: new Date(row.acquisition_date),
    year: new Date(row.acquisition_date).getFullYear(),
    dayNight: row.day_night_flag,
}));

const usTopo = await d3.json(STATES_URL);
const california = topojson.feature(usTopo, usTopo.objects.states).features
    .find((f) => f.id === CALIFORNIA_FIPS);

// California counties
const countiesTopo = await d3.json(COUNTIES_URL);
const allCountyFeatures = topojson.feature(countiesTopo, countiesTopo.objects.counties).features;
const caCounties = {
    type: 'FeatureCollection',
    features: allCountyFeatures.filter((f) => String(f.id).padStart(5, '0').startsWith('06')),
};

// Spatial filter: keep only fires actually inside California.
// The MODIS tile can include Nevada, Arizona, Baja California, etc.
const fires = rawFires.filter((d) =>
    d3.geoContains(california, [d.longitude, d.latitude]),
);

console.log(
    `Filtered to California: ${fires.length.toLocaleString()} of ${rawFires.length.toLocaleString()} fire detections`,
);

// ============================================================
// Scales
// ============================================================

const colorRamp = (t) => d3.interpolateInferno(0.15 + 0.85 * t);

const sortedFrp = fires.map((d) => d.frp).filter(Number.isFinite).sort(d3.ascending);
const frpMax = d3.quantile(sortedFrp, 0.99);
const frpCap = 500;

const frpColorScale = d3.scaleThreshold()
    .domain([25, 100, 250, 500])
    .range([
        colorRamp(0),
        colorRamp(0.25),
        colorRamp(0.5),
        colorRamp(0.75),
        colorRamp(1.0),
    ]);

// Render larger dots first so smaller dots remain hoverable.
const sortedFires = d3.sort(fires, (d) => -d.frp);

// ============================================================
// Southern California map region
// ============================================================

// This controls what the SVG map fits to.
// It focuses on Southern California rather than the full state.
const southernCaliforniaRegion = {
    type: 'MultiPoint',
    coordinates: [
        [-122.2, 31.8], // southwest-ish corner
        [-113.8, 37.2], // northeast-ish corner
    ],
};

let circleSelection;

renderMap(sortedFires, california, southernCaliforniaRegion);

// ============================================================
// Map rendering
// ============================================================

function renderMap(data, stateFeature, fitRegion) {
    const width = 900;
    const height = 680;
    const padding = 24;

    const svg = d3
        .select('#map')
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const projection = d3
        .geoMercator()
        .fitExtent([[padding, padding], [width - padding, height - padding]], fitRegion);

    const path = d3.geoPath(projection);

    // California outline. Because the projection is fitted to Southern CA,
    // only the Southern California portion will be visible in the SVG viewport.
    svg
        .append('path')
        .datum(stateFeature)
        .attr('class', 'state')
        .attr('d', path);

    // County boundary lines.
    svg
        .append('g')
        .attr('class', 'counties')
        .selectAll('path')
        .data(caCounties.features)
        .join('path')
        .attr('d', path);

    // Fire points.
    circleSelection = svg
        .append('g')
        .attr('class', 'fires')
        .selectAll('circle')
        .data(data)
        .join('circle')
        .attr('class', 'fire')
        .attr('cx', (d) => projection([d.longitude, d.latitude])[0])
        .attr('cy', (d) => projection([d.longitude, d.latitude])[1])
        .attr('r', 2)
        .attr('fill', (d) => frpColorScale(d.frp))
        .on('mouseenter', (event, d) => {
            d3.select(event.currentTarget).style('fill-opacity', 1);
            renderTooltipContent(d);
            updateTooltipVisibility(true);
            updateTooltipPosition(event);
        })
        .on('mousemove', (event) => updateTooltipPosition(event))
        .on('mouseleave', (event) => {
            d3.select(event.currentTarget).style('fill-opacity', null);
            updateTooltipVisibility(false);
        });

    // Region labels.
    const regionGroup = svg.append('g').attr('class', 'region-labels');

    regionGroup
        .selectAll('text')
        .data(REGION_LABELS)
        .join('text')
        .attr('class', 'region-label')
        .attr('x', (d) => projection([d.lon, d.lat])[0])
        .attr('y', (d) => projection([d.lon, d.lat])[1])
        .attr('text-anchor', 'middle')
        .text((d) => d.name);

    // City markers + labels.
    const cityGroup = svg.append('g').attr('class', 'city-labels');

    const cities = cityGroup
        .selectAll('g')
        .data(CITY_LABELS)
        .join('g')
        .attr('class', 'city')
        .attr('transform', (d) => {
            const [x, y] = projection([d.lon, d.lat]);
            return `translate(${x}, ${y})`;
        });

    cities.append('circle')
        .attr('class', 'city-dot')
        .attr('r', 3);

    cities
        .append('text')
        .attr('class', 'city-name')
        .attr('x', (d) => d.dx)
        .attr('y', 4)
        .attr('text-anchor', (d) => d.anchor)
        .text((d) => d.name);

    drawColorLegend(svg, width);
}

// ============================================================
// Filters / dynamic queries
// ============================================================

const filterState = {
    frpMin: 0,
    frpMax: frpCap,
    day: true,
    night: true,
    dateMin: null,
    dateMax: null,
};

function isMatch(d) {
    const frpValue = Math.min(d.frp, frpCap);

    if (frpValue < filterState.frpMin || frpValue > filterState.frpMax) return false;
    if (!filterState.day && d.dayNight === 'Daytime Fire') return false;
    if (!filterState.night && d.dayNight === 'Nighttime Fire') return false;
    if (filterState.dateMin && d.date < filterState.dateMin) return false;
    if (filterState.dateMax && d.date > filterState.dateMax) return false;

    return true;
}

let rafScheduled = false;

function scheduleApplyFilters() {
    if (rafScheduled) return;

    rafScheduled = true;

    requestAnimationFrame(() => {
        rafScheduled = false;
        applyFilters();
    });
}

function applyFilters() {
    if (!circleSelection) return;

    let matches = 0;

    circleSelection.attr('display', (d) => {
        const match = isMatch(d);
        if (match) matches++;
        return match ? null : 'none';
    });

    document.getElementById('match-count').textContent = matches.toLocaleString();
}

function setupControls() {
    const frpMinEl = document.getElementById('frp-min');
    const frpMaxEl = document.getElementById('frp-max');
    const frpRangeDisp = document.getElementById('frp-range-display');

    const frpMaxRounded = frpCap;

    frpMinEl.max = frpMaxRounded;
    frpMaxEl.max = frpMaxRounded;
    frpMaxEl.value = frpMaxRounded;

    const updateFrpRange = (source) => {
        let min = +frpMinEl.value;
        let max = +frpMaxEl.value;

        if (min > max) {
            if (source === frpMinEl) {
                max = min;
                frpMaxEl.value = max;
            } else {
                min = max;
                frpMinEl.value = min;
            }
        }

        filterState.frpMin = min;
        filterState.frpMax = max;

        const maxLabel = max >= frpMaxRounded ? `${frpMaxRounded}+` : `${max}`;
        frpRangeDisp.textContent = `${min} - ${maxLabel} MW`;

        scheduleApplyFilters();
    };

    frpMinEl.addEventListener('input', () => updateFrpRange(frpMinEl));
    frpMaxEl.addEventListener('input', () => updateFrpRange(frpMaxEl));

    updateFrpRange();

    document.getElementById('dn-day').addEventListener('change', (e) => {
        filterState.day = e.target.checked;
        scheduleApplyFilters();
    });

    document.getElementById('dn-night').addEventListener('change', (e) => {
        filterState.night = e.target.checked;
        scheduleApplyFilters();
    });

    document.getElementById('total-count').textContent = fires.length.toLocaleString();
    document.getElementById('match-count').textContent = fires.length.toLocaleString();

    applyFilters();
}

setupControls();
renderTimeline(fires);

// ============================================================
// Brushable timeline strip
// ============================================================

function renderTimeline(data) {
    const container = d3.select('#timeline');

    const width = 260;
    const height = 650;
    const margin = { top: 12, right: 20, bottom: 40, left: 38 };

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const dailyMap = d3.rollup(
        data,
        (v) => v.length,
        (d) => d3.timeDay.floor(d.date).getTime(),
    );

    const daily = Array.from(dailyMap, ([t, count]) => ({
        date: new Date(+t),
        count,
    })).sort((a, b) => a.date - b.date);

    const yExtent = d3.extent(data, (d) => d.date);
    const yScale = d3.scaleTime().domain(yExtent).range([0, innerH]).nice();

    const xMax = d3.max(daily, (d) => d.count);
    const xScale = d3.scaleLinear().domain([0, xMax]).nice().range([0, innerW]);

    const svg = container
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const bars = g
        .append('g')
        .attr('class', 'bars')
        .selectAll('rect')
        .data(daily)
        .join('rect')
        .attr('class', 'bar')
        .attr('y', (d) => yScale(d.date) - 1)
        .attr('x', 0)
        .attr('height', 2)
        .attr('width', (d) => xScale(d.count))
        .attr('fill', 'var(--accent)')
        .attr('fill-opacity', 0.7);

    g.append('g')
        .attr('class', 'axis y-axis')
        .call(
            d3
                .axisLeft(yScale)
                .ticks(d3.timeYear.every(1))
                .tickFormat(d3.timeFormat('%Y'))
                .tickSizeOuter(0),
        );

    g.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0, ${innerH})`)
        .call(d3.axisBottom(xScale).ticks(3).tickSizeOuter(0));

    const brush = d3
        .brushY()
        .extent([[0, 0], [innerW, innerH]])
        .on('brush end', brushed);

    g.append('g')
        .attr('class', 'brush')
        .call(brush);

    function brushed(event) {
        const sel = event.selection;

        if (!sel) {
            filterState.dateMin = null;
            filterState.dateMax = null;
            bars.attr('fill-opacity', 0.7);
        } else {
            const [y0, y1] = sel;

            filterState.dateMin = yScale.invert(y0);
            filterState.dateMax = yScale.invert(y1);

            bars.attr('fill-opacity', (d) => {
                const y = yScale(d.date);
                return y >= y0 && y <= y1 ? 1 : 0.2;
            });
        }

        scheduleApplyFilters();
    }
}

// ============================================================
// Legend
// ============================================================

function drawColorLegend(svg, width) {
    const legendW = 220;
    const legendH = 10;
    const padX = 12;
    const padY = 10;
    const titleH = 18;
    const tickH = 18;
    const x = width - legendW - padX - 20;
    const y = 20;

    const g = svg
        .append('g')
        .attr('class', 'legend color-legend')
        .attr('transform', `translate(${x}, ${y})`);

    g.append('rect')
        .attr('class', 'legend-bg')
        .attr('x', -padX)
        .attr('y', -padY)
        .attr('width', legendW + padX * 2)
        .attr('height', titleH + legendH + tickH + padY * 2 - 4)
        .attr('rx', 6);

    g.append('text')
        .attr('class', 'legend-title')
        .attr('y', 4)
        .text('Fire Radiative Power (MW)');

    const thresholds = frpColorScale.domain();
    const colors = frpColorScale.range();
    const binCount = thresholds.length + 1;
    const binWidth = legendW / binCount;

    const legendItems = g
        .append('g')
        .attr('transform', `translate(0, ${titleH - 4})`);

    for (let i = 0; i < binCount; i++) {
        const isFirst = i === 0;
        const isLast = i === binCount - 1;
        const lowerBound = isFirst ? 0 : thresholds[i - 1];

        const item = legendItems
            .append('g')
            .attr('transform', `translate(${i * binWidth}, 0)`);

        item.append('rect')
            .attr('width', binWidth)
            .attr('height', legendH)
            .attr('fill', colors[i]);

        if (!isFirst) {
            item.append('text')
                .attr('class', 'legend-tick')
                .attr('x', 0)
                .attr('y', legendH + 14)
                .attr('text-anchor', 'middle')
                .text(lowerBound);
        }
    }
}

// ============================================================
// Tooltip
// ============================================================

function renderTooltipContent(d) {
    document.getElementById('t-date').textContent = d.date.toLocaleDateString(
        'en',
        { year: 'numeric', month: 'short', day: 'numeric' },
    );

    document.getElementById('t-time').textContent = d.acquisition_time_UTC ?? '–';
    document.getElementById('t-daynight').textContent = d.dayNight ?? '–';
    document.getElementById('t-frp').textContent = `${d.frp.toFixed(1)} MW`;
    document.getElementById('t-brightness').textContent = `${d.brightness.toFixed(1)} K`;
    document.getElementById('t-confidence').textContent = `${d.confidence.toFixed(0)}%`;
    document.getElementById('t-coords').textContent = `${d.latitude.toFixed(3)}, ${d.longitude.toFixed(3)}`;
}

function updateTooltipVisibility(isVisible) {
    const tooltip = document.getElementById('fire-tooltip');
    tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
    const tooltip = document.getElementById('fire-tooltip');
    const offset = 14;

    tooltip.style.left = `${event.clientX + offset}px`;
    tooltip.style.top = `${event.clientY + offset}px`;
}