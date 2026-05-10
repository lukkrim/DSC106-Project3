import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';

const DATA_URL = 'terra_fire_california_2000_2025_windows/data.csv';
const STATES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const COUNTIES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';
const CALIFORNIA_FIPS = '06';

// Major SoCal cities & regional labels for geographic context.
const CITY_LABELS = [
    { name: 'Los Angeles', lat: 34.05, lon: -118.25, anchor: 'start', dx: 6 },
    { name: 'San Diego', lat: 32.72, lon: -117.16, anchor: 'start', dx: 6 },
    { name: 'Santa Barbara', lat: 34.42, lon: -119.70, anchor: 'end', dx: -6 },
    { name: 'Bakersfield', lat: 35.37, lon: -119.02, anchor: 'start', dx: 6 },
    { name: 'Fresno', lat: 36.74, lon: -119.79, anchor: 'start', dx: 6 },
    { name: 'Palm Springs', lat: 33.83, lon: -116.55, anchor: 'start', dx: 6 },
];

const REGION_LABELS = [
    { name: 'PACIFIC OCEAN', lat: 33.0, lon: -121.5 },
    { name: 'Mojave Desert', lat: 35.2, lon: -116.5 },
    { name: 'Sierra Nevada', lat: 36.4, lon: -118.4 },
];

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

// California counties (FIPS state code "06", padded to 5 digits)
const countiesTopo = await d3.json(COUNTIES_URL);
const allCountyFeatures = topojson.feature(countiesTopo, countiesTopo.objects.counties).features;
const caCounties = {
    type: 'FeatureCollection',
    features: allCountyFeatures.filter((f) => String(f.id).padStart(5, '0').startsWith('06')),
};

// Spatial filter: keep only fires actually inside California (the MODIS tile
// also captured Nevada, Arizona, and Baja California, which we don't want).
const fires = rawFires.filter((d) =>
    d3.geoContains(california, [d.longitude, d.latitude]),
);
console.log(
    `Filtered to California: ${fires.length.toLocaleString()} of ${rawFires.length.toLocaleString()} fire detections`,
);

// Shifted inferno: skip the very darkest portion so 2000 is still visible
// against the dark background, while preserving the fire-evocative palette.
const colorRamp = (t) => d3.interpolateInferno(0.15 + 0.85 * t);

const yearExtent = d3.extent(fires, (d) => d.year);
const colorScale = d3.scaleSequential(colorRamp).domain(yearExtent);

// Use the 99th-percentile FRP as the size-scale max so a few extreme outliers
// don't compress every other dot into invisibility.
const sortedFrp = fires.map((d) => d.frp).filter(Number.isFinite).sort(d3.ascending);
const frpMax = d3.quantile(sortedFrp, 0.99);
const rScale = d3.scaleSqrt().domain([0, frpMax]).range([1, 5]).clamp(true);

// Render larger dots first so smaller (often more recent / higher year) dots
// stay hoverable on top.
const sortedFires = d3.sort(fires, (d) => -d.frp);

// Data only covers Southern California (lat 32-36.35, lon -121.85 to -114).
// Use a MultiPoint covering the corners of the data footprint as the fit
// region. (A Polygon here trips up d3's spherical clipping and silently
// leaves the projection at default world scale.)
const dataRegion = {
    type: 'MultiPoint',
    coordinates: [
        [-122.3, 31.7],
        [-113.7, 36.7],
    ],
};

// Declared before renderMap is called so the function can assign to it.
// (With `let`, accessing a variable before its declaration throws.)
let circleSelection;

renderMap(sortedFires, california, dataRegion);

function renderMap(data, stateFeature, fitRegion) {
    const width = 900;
    const height = 580;
    const padding = 20;

    const svg = d3
        .select('#map')
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const projection = d3
        .geoMercator()
        .fitExtent([[padding, padding], [width - padding, height - padding]], fitRegion);
    const path = d3.geoPath(projection);

    svg
        .append('path')
        .datum(stateFeature)
        .attr('class', 'state')
        .attr('d', path);

    // County boundary lines, drawn just inside the state outline.
    svg
        .append('g')
        .attr('class', 'counties')
        .selectAll('path')
        .data(caCounties.features)
        .join('path')
        .attr('d', path);

    circleSelection = svg
        .append('g')
        .attr('class', 'fires')
        .selectAll('circle')
        .data(data)
        .join('circle')
        .attr('class', 'fire')
        .attr('cx', (d) => projection([d.longitude, d.latitude])[0])
        .attr('cy', (d) => projection([d.longitude, d.latitude])[1])
        .attr('r', (d) => rScale(d.frp))
        .attr('fill', (d) => colorScale(d.year))
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

    // Region labels (drawn under cities so cities sit on top)
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

    // City markers + name labels
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

    cities.append('circle').attr('class', 'city-dot').attr('r', 3);
    cities
        .append('text')
        .attr('class', 'city-name')
        .attr('x', (d) => d.dx)
        .attr('y', 4)
        .attr('text-anchor', (d) => d.anchor)
        .text((d) => d.name);

    drawColorLegend(svg, width);
    drawSizeLegend(svg, width, height);
}

// ============================================================
// Filters / dynamic queries
// ============================================================

const filterState = {
    yearMin: yearExtent[0],
    yearMax: yearExtent[1],
    frpMin: 0,
    day: true,
    night: true,
    dateMin: null,
    dateMax: null,
};

function isMatch(d) {
    if (d.year < filterState.yearMin || d.year > filterState.yearMax) return false;
    if (d.frp < filterState.frpMin) return false;
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
    const yearMinEl = document.getElementById('year-min');
    const yearMaxEl = document.getElementById('year-max');
    const yearMinDisp = document.getElementById('year-min-display');
    const yearMaxDisp = document.getElementById('year-max-display');

    yearMinEl.min = yearExtent[0];
    yearMinEl.max = yearExtent[1];
    yearMinEl.value = yearExtent[0];
    yearMaxEl.min = yearExtent[0];
    yearMaxEl.max = yearExtent[1];
    yearMaxEl.value = yearExtent[1];
    yearMinDisp.textContent = yearExtent[0];
    yearMaxDisp.textContent = yearExtent[1];

    yearMinEl.addEventListener('input', () => {
        let v = +yearMinEl.value;
        if (v > filterState.yearMax) {
            v = filterState.yearMax;
            yearMinEl.value = v;
        }
        filterState.yearMin = v;
        yearMinDisp.textContent = v;
        scheduleApplyFilters();
    });

    yearMaxEl.addEventListener('input', () => {
        let v = +yearMaxEl.value;
        if (v < filterState.yearMin) {
            v = filterState.yearMin;
            yearMaxEl.value = v;
        }
        filterState.yearMax = v;
        yearMaxDisp.textContent = v;
        scheduleApplyFilters();
    });

    const frpMinEl = document.getElementById('frp-min');
    const frpMinDisp = document.getElementById('frp-min-display');
    frpMinEl.addEventListener('input', () => {
        filterState.frpMin = +frpMinEl.value;
        frpMinDisp.textContent = filterState.frpMin;
        scheduleApplyFilters();
    });

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
}

setupControls();
renderTimeline(fires);

// ============================================================
// Brushable timeline strip
// ============================================================

function renderTimeline(data) {
    const container = d3.select('#timeline');
    const width = 900;
    const height = 150;
    const margin = { top: 12, right: 20, bottom: 40, left: 38 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    // Pre-aggregate fires per day. Most days outside fire season are absent,
    // so the chart will naturally show 26 vertical "season bands".
    const dailyMap = d3.rollup(
        data,
        (v) => v.length,
        (d) => d3.timeDay.floor(d.date).getTime(),
    );
    const daily = Array.from(dailyMap, ([t, count]) => ({
        date: new Date(+t),
        count,
    })).sort((a, b) => a.date - b.date);

    const xExtent = d3.extent(data, (d) => d.date);
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]).nice();
    const yMax = d3.max(daily, (d) => d.count);
    const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    const svg = container
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Bars: thin vertical lines, one per day with detections.
    const bars = g
        .append('g')
        .attr('class', 'bars')
        .selectAll('rect')
        .data(daily)
        .join('rect')
        .attr('class', 'bar')
        .attr('x', (d) => xScale(d.date) - 1)
        .attr('y', (d) => yScale(d.count))
        .attr('width', 2)
        .attr('height', (d) => innerH - yScale(d.count))
        .attr('fill', 'var(--accent)')
        .attr('fill-opacity', 0.7);

    // X axis: every year (2000 - 2025), labels rotated for legibility
    const xAxisGroup = g
        .append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0, ${innerH})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(d3.timeYear.every(1))
                .tickFormat(d3.timeFormat('%Y'))
                .tickSizeOuter(0),
        );

    xAxisGroup
        .selectAll('text')
        .attr('transform', 'translate(-2, 4) rotate(-45)')
        .style('text-anchor', 'end');

    // Y axis (sparse)
    g.append('g')
        .attr('class', 'axis y-axis')
        .call(d3.axisLeft(yScale).ticks(3).tickSizeOuter(0));

    // Brush
    const brush = d3
        .brushX()
        .extent([[0, 0], [innerW, innerH]])
        .on('brush end', brushed);

    g.append('g').attr('class', 'brush').call(brush);

    function brushed(event) {
        const sel = event.selection;
        if (!sel) {
            filterState.dateMin = null;
            filterState.dateMax = null;
            bars.attr('fill-opacity', 0.7);
        } else {
            const [x0, x1] = sel;
            filterState.dateMin = xScale.invert(x0);
            filterState.dateMax = xScale.invert(x1);
            bars.attr('fill-opacity', (d) => {
                const x = xScale(d.date);
                return x >= x0 && x <= x1 ? 1 : 0.2;
            });
        }
        scheduleApplyFilters();
    }
}

function drawColorLegend(svg, width) {
    const legendW = 220;
    const legendH = 10;
    const padX = 12;
    const padY = 10;
    const titleH = 18;
    const tickH = 18;
    const x = width - legendW - padX - 20;
    const y = 20;

    const defs = svg.append('defs');
    const gradient = defs
        .append('linearGradient')
        .attr('id', 'year-gradient')
        .attr('x1', '0%')
        .attr('x2', '100%');

    const stops = 16;
    for (let i = 0; i <= stops; i++) {
        const t = i / stops;
        gradient
            .append('stop')
            .attr('offset', `${t * 100}%`)
            .attr('stop-color', colorRamp(t));
    }

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
        .text('Year of detection');

    g.append('rect')
        .attr('y', titleH - 4)
        .attr('width', legendW)
        .attr('height', legendH)
        .attr('rx', 2)
        .attr('fill', 'url(#year-gradient)');

    const tickYears = [yearExtent[0], 2005, 2010, 2015, 2020, yearExtent[1]];
    const xScale = d3.scaleLinear().domain(yearExtent).range([0, legendW]);

    g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0, ${titleH + legendH - 4})`)
        .call(
            d3
                .axisBottom(xScale)
                .tickValues(tickYears)
                .tickFormat(d3.format('d')),
        );
}

function drawSizeLegend(svg, width, height) {
    const samples = [10, 100, 500].filter((v) => v <= frpMax);
    const padX = 12;
    const padY = 10;
    const titleH = 18;
    const spacing = 60;
    const totalW = samples.length * spacing + 10;
    const x = width - totalW - padX - 20;
    const y = height - 70;

    const g = svg
        .append('g')
        .attr('class', 'legend size-legend')
        .attr('transform', `translate(${x}, ${y})`);

    g.append('rect')
        .attr('class', 'legend-bg')
        .attr('x', -padX)
        .attr('y', -padY)
        .attr('width', totalW + padX * 2)
        .attr('height', titleH + 40 + padY * 2 - 6)
        .attr('rx', 6);

    g.append('text')
        .attr('class', 'legend-title')
        .attr('y', 4)
        .text('Fire Radiative Power (MW)');

    samples.forEach((v, i) => {
        const cx = i * spacing + 15;
        const cy = titleH + 18;
        g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', rScale(v))
            .attr('fill', '#bbb')
            .attr('fill-opacity', 0.8);
        g.append('text')
            .attr('x', cx)
            .attr('y', cy + 22)
            .attr('text-anchor', 'middle')
            .text(v);
    });
}

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
