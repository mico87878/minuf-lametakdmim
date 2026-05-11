'use strict';

// ============================================================
// קבועים
// ============================================================

const LEVERAGE_DEFAULTS = {
  keren_hishtalmut:          { klali: 60, mnayati: 80 },
  keren_hishtalmut_lo_nazil: { klali: 50, mnayati: 50 },
  kupat_gemel:               { klali: 80, mnayati: 60 },
  polisa:                    { klali: 80, mnayati: 60 },
};

const RETURN_DEFAULTS = { klali: 7.5, mnayati: 10.0 };

const METHOD_LABELS = { shpitzer: 'שפיצר', grace: 'גרייס', balloon: 'בלון' };

// ============================================================
// פורמט מספרים
// ============================================================

const numFmt = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });

function fmtShekel(n) {
  return numFmt.format(Math.round(n)) + ' ₪';
}

function fmtPct(n) {
  return n.toFixed(1) + '%';
}

// ============================================================
// פונקציות חישוב טהורות
// ============================================================

// תשלום חודשי שפיצר
function calcShpitzerPayment(P, annualRate, years) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return P / n;
  return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// צמיחת הקרן — מחזיר מערך שנתי
function calcFundGrowth(initialBalance, monthlyDeposit, effectiveAnnualReturn, years) {
  const monthlyRate = effectiveAnnualReturn / 100 / 12;
  let balance = initialBalance;
  const rows = [];

  for (let y = 1; y <= years; y++) {
    const startBalance = balance;
    let yearDeposits = 0;
    let yearGains = 0;

    for (let m = 0; m < 12; m++) {
      const gain = balance * monthlyRate;
      yearGains += gain;
      balance += gain + monthlyDeposit;
      yearDeposits += monthlyDeposit;
    }

    rows.push({ year: y, startBalance, endBalance: balance, yearDeposits, yearGains });
  }

  return rows;
}

// לוח הלוואה — מחזיר מערך שנתי + סיכום
function calcLoan(P, annualRate, years, method) {
  const r = annualRate / 100 / 12;
  const rows = [];

  if (method === 'shpitzer') {
    const M = calcShpitzerPayment(P, annualRate, years);
    let balance = P;
    let totalPaid = 0;

    for (let y = 1; y <= years; y++) {
      const startBalance = balance;
      let yearInterest = 0;
      let yearPrincipal = 0;

      for (let m = 0; m < 12; m++) {
        const interest = balance * r;
        const principal = Math.min(M - interest, balance);
        yearInterest += interest;
        yearPrincipal += principal;
        balance = Math.max(0, balance - principal);
        totalPaid += M;
      }

      rows.push({
        year: y,
        startBalance,
        endBalance: Math.max(0, balance),
        yearInterest,
        yearPrincipal,
        yearTotal: yearInterest + yearPrincipal,
      });
    }

    const interestCost = totalPaid - P;
    return { monthlyPayment: M, totalPaid, remainingDebt: 0, interestCost, rows };

  } else if (method === 'grace') {
    const monthlyPayment = P * r;
    let totalPaid = 0;

    for (let y = 1; y <= years; y++) {
      const yearInterest = monthlyPayment * 12;
      totalPaid += yearInterest;
      rows.push({
        year: y,
        startBalance: P,
        endBalance: P,
        yearInterest,
        yearPrincipal: 0,
        yearTotal: yearInterest,
      });
    }

    // קרן מגולגלת קדימה — לא מנוכה מהתוצאה
    return { monthlyPayment, totalPaid, remainingDebt: P, interestCost: totalPaid, rows };

  } else {
    // בלון — ריבית דריבית, אין תשלומים שוטפים
    let debtBalance = P;

    for (let y = 1; y <= years; y++) {
      const startBalance = debtBalance;
      for (let m = 0; m < 12; m++) debtBalance *= (1 + r);
      rows.push({
        year: y,
        startBalance,
        endBalance: debtBalance,
        yearInterest: debtBalance - startBalance,
        yearPrincipal: 0,
        yearTotal: 0,
      });
    }

    const interestCost = debtBalance - P;
    // קרן + ריבית מגולגלים קדימה — לא מנוכים מהתוצאה
    return { monthlyPayment: 0, totalPaid: 0, remainingDebt: debtBalance, interestCost, rows };
  }
}

// חישוב מלא לסט קלט
function runCalc(inputs) {
  const {
    balance, monthlyDeposit, annualReturn, managementFee,
    leveragePct, loanRate, years, method,
  } = inputs;

  const effectiveReturn = annualReturn - managementFee;
  const loanAmount = balance * leveragePct / 100;
  const breakEven = (leveragePct / 100) * loanRate + managementFee;
  const margin = annualReturn - breakEven;

  const fundRows = calcFundGrowth(balance, monthlyDeposit, effectiveReturn, years);
  const loan = calcLoan(loanAmount, loanRate, years, method);

  const fundTotalGains = fundRows.reduce((s, r) => s + r.yearGains, 0);
  const gainsDiff = fundTotalGains - loan.interestCost;

  return { loanAmount, breakEven, margin, fundRows, loan, fundTotalGains, gainsDiff, inputs };
}

// ============================================================
// ניהול גרפים
// ============================================================

const charts = {};

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

const CHART_DEFAULTS = {
  font: { family: 'Heebo', size: 11 },
  tooltipCallback: (ctx) => ctx.dataset.label + ': ' + fmtShekel(ctx.raw),
  yTickCallback: (v) => fmtShekel(v),
};

function buildChart(id, type, datasets, extraOptions = {}) {
  destroyChart(id);
  const ctx = document.getElementById(id);
  charts[id] = new Chart(ctx, {
    type,
    data: { labels: extraOptions.labels || [], datasets },
    options: {
      responsive: true,
      animation: { duration: 300 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: CHART_DEFAULTS.font, boxWidth: 12, padding: 14 },
        },
        tooltip: {
          callbacks: { label: CHART_DEFAULTS.tooltipCallback },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: CHART_DEFAULTS.yTickCallback,
            font: CHART_DEFAULTS.font,
            maxTicksLimit: 6,
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        x: {
          ticks: { font: CHART_DEFAULTS.font },
          grid: { display: false },
        },
      },
      ...extraOptions.overrides,
    },
  });
}

function renderCharts(result) {
  const { fundRows, loan } = result;
  const labels = fundRows.map((r) => `שנה ${r.year}`);

  // גרף 1: רווח קרן מצטבר vs עלות ריבית מצטברת
  let cumGains = 0, cumInterest = 0;
  const cumulativeGains    = fundRows.map((r) => { cumGains    += r.yearGains;          return cumGains; });
  const cumulativeInterest = loan.rows.map((r) => { cumInterest += r.yearInterest;      return cumInterest; });
  const cumulativeDiff     = cumulativeGains.map((g, i) => g - cumulativeInterest[i]);

  buildChart('chart-fund', 'line', [
    {
      label: 'רווח הקרן (מצטבר)',
      data: cumulativeGains,
      borderColor: '#1d8348',
      backgroundColor: 'rgba(29,131,72,0.08)',
      fill: true,
      tension: 0.35,
      pointRadius: 4,
    },
    {
      label: 'עלות ריבית (מצטברת)',
      data: cumulativeInterest,
      borderColor: '#c0392b',
      backgroundColor: 'rgba(192,57,43,0.06)',
      fill: true,
      tension: 0.35,
      pointRadius: 4,
    },
    {
      label: 'הפרש (רווח נטו מהמינוף)',
      data: cumulativeDiff,
      borderColor: '#0078d4',
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.35,
      pointRadius: 4,
      borderDash: [6, 3],
      borderWidth: 2,
    },
  ], { labels });

  // גרף 2: יתרת חוב
  buildChart('chart-debt', 'line', [
    {
      label: 'יתרת חוב',
      data: loan.rows.map((r) => r.endBalance),
      borderColor: '#c0392b',
      backgroundColor: 'rgba(192,57,43,0.07)',
      fill: true,
      tension: 0.35,
      pointRadius: 4,
    },
  ], { labels });

  // גרף 3: עמודות שנתיות
  buildChart('chart-annual', 'bar', [
    {
      label: 'רווחי קרן שנתיים',
      data: fundRows.map((r) => r.yearGains),
      backgroundColor: 'rgba(0,120,212,0.72)',
      borderRadius: 4,
    },
    {
      label: 'ריבית שנתית (שולמה / הצטברה)',
      data: loan.rows.map((r) => r.yearInterest),
      backgroundColor: 'rgba(192,57,43,0.65)',
      borderRadius: 4,
    },
  ], { labels });
}

// ============================================================
// עדכון DOM
// ============================================================

function updateHeroCards(result) {
  const { loanAmount, breakEven, margin, loan, inputs } = result;

  // כרטיס 1: סכום הלוואה
  document.getElementById('card-loan').textContent = fmtShekel(loanAmount);
  document.getElementById('card-loan-sub').textContent =
    fmtPct(inputs.leveragePct) + ' מהקרן';

  // כרטיס 2: החזר חודשי
  document.getElementById('card-monthly').textContent =
    loan.monthlyPayment === 0 ? '0 ₪' : fmtShekel(loan.monthlyPayment);
  document.getElementById('card-monthly-sub').textContent =
    METHOD_LABELS[inputs.method];

  // כרטיס 3: נקודת איזון
  document.getElementById('card-breakeven').textContent = fmtPct(breakEven);
  const marginEl = document.getElementById('card-margin');
  if (margin >= 0) {
    marginEl.textContent = '+' + fmtPct(margin) + ' מעל האיזון';
    marginEl.style.color = 'var(--green)';
  } else {
    marginEl.textContent = fmtPct(Math.abs(margin)) + ' מתחת לאיזון';
    marginEl.style.color = 'var(--red)';
  }

  // כרטיס 4: סה"כ צבירות
  const fundFinal    = result.fundRows[result.fundRows.length - 1].endBalance;
  const remainDebt   = loan.remainingDebt;
  const netValue     = fundFinal - remainDebt;

  document.getElementById('card-fund-value').textContent = fmtShekel(fundFinal);

  const rowDebt = document.getElementById('row-debt-accum');
  if (remainDebt > 0.5) {
    document.getElementById('card-debt-value').textContent = fmtShekel(remainDebt);
    rowDebt.style.display = '';
    const accumTotal = fundFinal + remainDebt;
    document.getElementById('accum-bar-fund').style.width = (fundFinal  / accumTotal * 100).toFixed(1) + '%';
    document.getElementById('accum-bar-debt').style.width = (remainDebt / accumTotal * 100).toFixed(1) + '%';
  } else {
    rowDebt.style.display = 'none';
    document.getElementById('accum-bar-fund').style.width = '100%';
    document.getElementById('accum-bar-debt').style.width = '0%';
  }

  const netEl = document.getElementById('card-net-value');
  netEl.textContent = (netValue >= 0 ? '+' : '') + fmtShekel(netValue);
  netEl.style.color = netValue >= 0 ? 'var(--green)' : 'var(--red)';

  // כרטיס 5: רווח קרן מול עלות ריבית
  const { fundTotalGains, gainsDiff } = result;
  document.getElementById('card-fund-gains').textContent = '+' + fmtShekel(fundTotalGains);
  document.getElementById('card-interest-cost').textContent = '-' + fmtShekel(loan.interestCost);

  // סרגל צבעים
  const total = fundTotalGains + loan.interestCost;
  const gainsPct = total > 0 ? (fundTotalGains / total * 100).toFixed(1) : 50;
  const intPct   = total > 0 ? (loan.interestCost / total * 100).toFixed(1) : 50;
  document.getElementById('gvi-bar-gains').style.width    = gainsPct + '%';
  document.getElementById('gvi-bar-interest').style.width = intPct + '%';

  const diffEl = document.getElementById('card-gains-diff');
  diffEl.textContent = (gainsDiff >= 0 ? '+' : '') + fmtShekel(gainsDiff);
  diffEl.style.color = gainsDiff >= 0 ? 'var(--green)' : 'var(--red)';

  const rolloverEl = document.getElementById('card-rollover');
  if (loan.remainingDebt > 0) {
    rolloverEl.textContent = 'יתרה לגלגול: ' + fmtShekel(loan.remainingDebt);
  } else {
    rolloverEl.textContent = 'חוב שולם במלואו';
  }
}

function updateAnnualTable(result) {
  const { fundRows, loan } = result;
  const tbody = document.getElementById('annual-tbody');
  tbody.innerHTML = '';

  fundRows.forEach((f, i) => {
    const l = loan.rows[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${f.year}</strong></td>
      <td>${fmtShekel(f.startBalance)}</td>
      <td>${fmtShekel(f.yearDeposits)}</td>
      <td class="cell-pos">${fmtShekel(f.yearGains)}</td>
      <td>${fmtShekel(f.endBalance)}</td>
      <td class="${l.endBalance > 0.5 ? 'cell-neg' : ''}">${fmtShekel(l.endBalance)}</td>
      <td>${fmtShekel(l.yearInterest)}</td>
      <td>${fmtShekel(l.yearPrincipal)}</td>
      <td>${fmtShekel(l.yearTotal)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// בונה שורות טבלת השוואה מרשימת תוצאות
function buildComparisonRows(results) {
  const lastFundValue = (r) => r.fundRows[r.fundRows.length - 1].endBalance;
  const lastDebtValue = (r) => r.loan.rows[r.loan.rows.length - 1].endBalance;

  const rowDefs = [
    { label: 'החזר חודשי',          fn: (r) => fmtShekel(r.loan.monthlyPayment) },
    { label: 'סך תשלומים בתקופה',   fn: (r) => fmtShekel(r.loan.totalPaid) },
    { label: 'עלות ריבית כוללת',     fn: (r) => fmtShekel(r.loan.interestCost) },
    { label: 'יתרת חוב לגלגול',     fn: (r) => {
        const v = r.loan.remainingDebt;
        return v > 0.5 ? `<span class="cell-neg">${fmtShekel(v)}</span>` : '<span class="cell-info">—</span>';
      }
    },
    { label: 'ערך הקרן בסוף',        fn: (r) => fmtShekel(lastFundValue(r)) },
    { label: 'קרן פחות חוב (נטו)',   fn: (r) => {
        const v = lastFundValue(r) - lastDebtValue(r);
        return `<span class="${v >= 0 ? 'cell-pos' : 'cell-neg'}">${fmtShekel(v)}</span>`;
      }
    },
    { label: 'הפרש — קרן מול ריבית', fn: (r) => {
        const v = r.gainsDiff;
        return `<span class="${v >= 0 ? 'cell-pos' : 'cell-neg'}">${(v >= 0 ? '+' : '') + fmtShekel(v)}</span>`;
      }
    },
  ];

  return rowDefs
    .map((row) => `
      <tr>
        <td class="row-header">${row.label}</td>
        ${results.map((r) => `<td>${row.fn(r)}</td>`).join('')}
      </tr>
    `)
    .join('');
}

function updateMethodsComparison(inputs) {
  const methods = ['shpitzer', 'grace', 'balloon'];
  const results = methods.map((m) => runCalc({ ...inputs, method: m }));
  document.getElementById('methods-tbody').innerHTML = buildComparisonRows(results);
}

function updateScenariosComparison(inputs) {
  const base = inputs.annualReturn;
  const pessimisticReturn = Math.max(0, base - 3);
  const scenarios = [
    { label: `פסימי (${fmtPct(pessimisticReturn)})`, return: pessimisticReturn },
    { label: `בסיסי (${fmtPct(base)})`,              return: base },
    { label: `אופטימי (${fmtPct(base + 3)})`,        return: base + 3 },
  ];

  document.getElementById('th-pessimistic').textContent = scenarios[0].label;
  document.getElementById('th-base').textContent        = scenarios[1].label;
  document.getElementById('th-optimistic').textContent  = scenarios[2].label;

  const results = scenarios.map((s) => runCalc({ ...inputs, annualReturn: s.return }));
  document.getElementById('scenarios-tbody').innerHTML = buildComparisonRows(results);
}

// ============================================================
// קריאת קלט + וולידציה
// ============================================================

function getInputs() {
  return {
    instrument:     document.getElementById('instrument').value,
    track:          document.getElementById('track').value,
    balance:        parseFloat(document.getElementById('balance').value)        || 0,
    monthlyDeposit: parseFloat(document.getElementById('monthlyDeposit').value) || 0,
    annualReturn:   parseFloat(document.getElementById('annualReturn').value)   || 0,
    managementFee:  parseFloat(document.getElementById('managementFee').value)  || 0,
    leveragePct:    parseFloat(document.getElementById('leveragePct').value)    || 0,
    loanRate:       parseFloat(document.getElementById('loanRate').value)       || 0,
    years:          parseInt(document.getElementById('years').value)            || 7,
    method:         document.querySelector('input[name="method"]:checked').value,
  };
}

function validate(inputs) {
  let ok = true;

  function setErr(fieldId, errId, msg) {
    const errEl = document.getElementById(errId);
    if (errEl) errEl.textContent = msg;
    document.getElementById(fieldId)?.classList.toggle('invalid', !!msg);
    if (msg) ok = false;
  }

  setErr('balance', 'err-balance',
    inputs.balance <= 0 ? 'יתרת הקרן חייבת להיות גדולה מ-0' : '');

  setErr('annualReturn', 'err-return',
    (inputs.annualReturn < 0 || inputs.annualReturn > 50) ? 'תשואה חייבת להיות בין 0 ל-50%' : '');

  return ok;
}

// ============================================================
// רינדור ראשי
// ============================================================

function render() {
  const inputs = getInputs();
  if (!validate(inputs)) return;

  const result = runCalc(inputs);

  document.getElementById('results-section').classList.remove('results-hidden');

  updateHeroCards(result);
  updateAnnualTable(result);
  renderCharts(result);
  updateMethodsComparison(inputs);
  updateScenariosComparison(inputs);

  // עדכון תשואה אפקטיבית
  const effective = inputs.annualReturn - inputs.managementFee;
  document.getElementById('display-effective-return').textContent = fmtPct(effective);

  // אינדיקציית עדכון
  const flash = document.getElementById('update-flash');
  flash.classList.add('visible');
  clearTimeout(flash._timer);
  flash._timer = setTimeout(() => flash.classList.remove('visible'), 1400);

  // שמירה ב-localStorage
  try { localStorage.setItem('leverage_inputs', JSON.stringify(inputs)); } catch (_) {}
}

// ============================================================
// Event Listeners
// ============================================================

let debounceTimer = null;

function scheduleRender() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, 280);
}

function updateLoanHint() {
  const balance    = parseFloat(document.getElementById('balance').value)     || 0;
  const leveragePct = parseFloat(document.getElementById('leveragePct').value) || 0;
  const hint = document.getElementById('hint-loan-amount');
  hint.textContent = balance > 0 ? 'סכום הלוואה: ' + fmtShekel(balance * leveragePct / 100) : '';
}

function applyDefaults() {
  const instrument = document.getElementById('instrument').value;
  const track      = document.getElementById('track').value;
  document.getElementById('leveragePct').value  = LEVERAGE_DEFAULTS[instrument][track];
  document.getElementById('annualReturn').value = RETURN_DEFAULTS[track];
}

function setupListeners() {
  // שינוי מכשיר — מעדכן ברירות מחדל
  document.getElementById('instrument').addEventListener('change', () => {
    applyDefaults();
    updateLoanHint();
    scheduleRender();
  });

  // שינוי מסלול — מעדכן ברירות מחדל
  document.getElementById('track').addEventListener('change', () => {
    applyDefaults();
    updateLoanHint();
    scheduleRender();
  });

  // שדות מספריים
  ['balance', 'monthlyDeposit', 'annualReturn', 'managementFee',
   'leveragePct', 'loanRate', 'years'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      updateLoanHint();
      scheduleRender();
    });
  });

  // שיטת החזר
  document.querySelectorAll('input[name="method"]').forEach((radio) => {
    radio.addEventListener('change', scheduleRender);
  });
}

// ============================================================
// אתחול
// ============================================================

function loadFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem('leverage_inputs') || 'null');
    if (!saved) return;
    const set = (id, val) => { if (val !== undefined && document.getElementById(id)) document.getElementById(id).value = val; };
    set('instrument',     saved.instrument);
    set('track',          saved.track);
    set('balance',        saved.balance);
    set('monthlyDeposit', saved.monthlyDeposit);
    set('annualReturn',   saved.annualReturn);
    set('managementFee',  saved.managementFee);
    set('leveragePct',    saved.leveragePct);
    set('loanRate',       saved.loanRate);
    set('years',          saved.years);
    if (saved.method) {
      const radio = document.querySelector(`input[name="method"][value="${saved.method}"]`);
      if (radio) radio.checked = true;
    }
  } catch (_) {}
}

// בדיקת סניטי לקונסול (לפי בקשת הפרומפט)
function runSanityCheck() {
  const testInputs = {
    balance: 200000, monthlyDeposit: 0, annualReturn: 10,
    managementFee: 0.7, leveragePct: 80, loanRate: 5.5, years: 7, method: 'balloon',
  };
  const r = runCalc(testInputs);
  // breakEven = (80/100)*5.5 + 0.7 = 5.1%  |  margin = 10 - 5.1 = 4.9%
  console.group('✅ בדיקת תרחיש — בלון, 7 שנים, 200K קרן, 10% תשואה, 5.5% ריבית, מינוף 80%');
  console.log('סכום הלוואה:',         fmtShekel(r.loanAmount),             '  ציפייה: 160,000 ₪');
  console.log('ערך הקרן בסוף:',       fmtShekel(r.fundRows[6].endBalance), '  ציפייה: ~382,000 ₪ (חישוב חודשי)');
  console.log('יתרת חוב (לגלגול):',   fmtShekel(r.loan.remainingDebt),     '  ציפייה: ~235,000 ₪ (חישוב חודשי)');
  console.log('עלות ריבית מצטברת:',   fmtShekel(r.loan.interestCost),      '  ציפייה: ~75,000 ₪');
  console.log('רווח קרן כולל:',       fmtShekel(r.fundTotalGains),         '  ציפייה: ~182,000 ₪');
  console.log('הפרש קרן מול ריבית:',  fmtShekel(r.gainsDiff),              '  ציפייה: ~107,000 ₪');
  console.log('נקודת איזון:',         fmtPct(r.breakEven),                 '  ציפייה: 5.1%');
  console.log('מרווח מעל איזון:',     fmtPct(r.margin),                    '  ציפייה: +4.9%');
  console.groupEnd();
}

document.addEventListener('DOMContentLoaded', () => {
  setupListeners();
  loadFromStorage();
  updateLoanHint();
  render();
  runSanityCheck();
});
