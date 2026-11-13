'use strict';

const form = document.getElementById('calculator');
const result = document.getElementById('result');
const statusMessage = document.getElementById('status');
const submitButton = document.getElementById('submit');
const advanced = document.getElementById('advanced');
const advancedPreview = document.getElementById('advanced-preview');
const errorList = document.getElementById('error-list');

const $ = (id) => document.getElementById(id);

const RULES = {
  price: (v) => (v > 0 ? '' : 'Укажите стоимость больше нуля'),
  rent: (v) => (v > 0 ? '' : 'Укажите аренду больше нуля'),
  downPayment: (v, all) => {
    if (!(v >= 0)) return 'Укажите сумму взноса';
    if (all.price > 0 && v > all.price) return 'Взнос не может быть больше стоимости квартиры';
    return '';
  },
  rate: (v) => (v >= 0.1 && v <= 50 ? '' : 'Укажите ставку от 0,1 до 50%'),
  priceGrowth: (v) => (v >= -20 && v <= 30 ? '' : 'Укажите значение от −20 до 30%'),
  rentGrowth: (v) => (v >= -20 && v <= 30 ? '' : 'Укажите значение от −20 до 30%'),
  deposit: (v) => (v >= 0 && v <= 50 ? '' : 'Укажите доходность от 0 до 50%'),
  upkeep: (v) => (v >= 0 && v <= 10 ? '' : 'Укажите значение от 0 до 10%'),
};

const MONEY_FIELDS = ['price', 'rent', 'downPayment'];

const NBSP = ' ';
const integerFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const oneDecimalFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rateFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function formatMoney(value) {
  return integerFormat.format(Math.round(value)) + NBSP + '₽';
}

function formatMoneyShort(value) {
  if (Math.abs(value) >= 1e6) return oneDecimalFormat.format(value / 1e6) + NBSP + 'млн' + NBSP + '₽';
  if (Math.abs(value) >= 1e3) return integerFormat.format(Math.round(value / 1e3)) + NBSP + 'тыс.' + NBSP + '₽';
  return formatMoney(value);
}

function plural(n, [one, few, many]) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function formatYears(n) {
  return n + NBSP + plural(n, ['год', 'года', 'лет']);
}

function parseNumber(str) {
  const clean = String(str).replace(/\s/g, '').replace(',', '.').replace('−', '-');
  if (clean === '') return NaN;
  return Number(clean);
}

function readForm() {
  const data = new FormData(form);
  const values = {};
  for (const name of Object.keys(RULES)) {
    values[name] = parseNumber(data.get(name));
  }
  values.term = Number(data.get('term'));
  values.horizon = Number(data.get('horizon'));
  return values;
}

function validate(values) {
  const errors = {};
  for (const [name, rule] of Object.entries(RULES)) {
    const message = rule(values[name], values);
    if (message) errors[name] = message;
  }
  return errors;
}

function getHint(input) {
  return $(input.getAttribute('aria-describedby'));
}

function setFieldError(input, message) {
  input.setAttribute('aria-invalid', 'true');
  input.closest('.field').classList.add('field--error');
  getHint(input).textContent = message;
}

function clearFieldError(input) {
  if (input.getAttribute('aria-invalid') !== 'true') return;
  input.removeAttribute('aria-invalid');
  input.closest('.field').classList.remove('field--error');
  const hint = getHint(input);
  hint.textContent = hint.dataset.default;
}

function showFieldErrors(errors) {
  for (const name of Object.keys(RULES)) {
    const input = form.elements[name];
    if (errors[name]) setFieldError(input, errors[name]);
    else clearFieldError(input);
  }
}

function simulate(v, ratePercent) {
  const loan = v.price - v.downPayment;
  const i = ratePercent / 100 / 12;
  const n = v.term * 12;
  const payment = loan <= 0 ? 0
    : i === 0 ? loan / n
    : (loan * i) / (1 - Math.pow(1 + i, -n));

  const depositMonthly = v.deposit / 100 / 12;
  const priceGrowthMonthly = Math.pow(1 + v.priceGrowth / 100, 1 / 12);
  const months = v.horizon * 12;

  let balance = Math.max(loan, 0);
  let flatValue = v.price;
  let rent = v.rent;
  let rentSavings = v.downPayment;
  let buySavings = 0;
  let interestPaid = 0;
  let rentPaid = 0;

  const rentSeries = [rentSavings];
  const buySeries = [flatValue - balance];

  for (let m = 1; m <= months; m++) {
    let mortgagePayment = 0;
    if (m <= n && balance > 0) {
      const interest = balance * i;
      mortgagePayment = Math.min(payment, balance + interest);
      balance -= mortgagePayment - interest;
      interestPaid += interest;
    }
    const upkeep = (flatValue * v.upkeep) / 100 / 12;

    rentSavings *= 1 + depositMonthly;
    buySavings *= 1 + depositMonthly;

    const difference = mortgagePayment + upkeep - rent;
    if (difference > 0) rentSavings += difference;
    else buySavings -= difference;

    rentPaid += rent;
    flatValue *= priceGrowthMonthly;

    if (m % 12 === 0) {
      rentSeries.push(rentSavings);
      buySeries.push(flatValue - balance + buySavings);
      rent *= 1 + v.rentGrowth / 100;
    }
  }

  return {
    payment,
    interestPaid,
    rentPaid,
    flatValue,
    balance: Math.max(balance, 0),
    buySavings,
    rentCapital: rentSavings,
    buyCapital: flatValue - balance + buySavings,
    rentSeries,
    buySeries,
  };
}

function findBreakevenRate(v) {
  const gap = (rate) => {
    const s = simulate(v, rate);
    return s.buyCapital - s.rentCapital;
  };
  let low = 0.1;
  let high = 50;
  if (gap(low) < 0) return { type: 'never' };
  if (gap(high) > 0) return { type: 'always' };
  for (let k = 0; k < 50; k++) {
    const mid = (low + high) / 2;
    if (gap(mid) > 0) low = mid;
    else high = mid;
  }
  return { type: 'rate', rate: (low + high) / 2 };
}

function calculate(values) {
  return {
    ...simulate(values, values.rate),
    breakeven: findBreakevenRate(values),
  };
}

function render(r, v) {
  const years = formatYears(v.horizon);
  const difference = Math.abs(r.rentCapital - r.buyCapital);
  const winner = r.rentCapital >= r.buyCapital ? 'rent' : 'buy';
  const almostEqual = difference < Math.max(r.rentCapital, r.buyCapital) * 0.02;

  $('res-tag').textContent = 'Ответ через ' + years;
  if (almostEqual) {
    $('res-title').textContent = 'Почти одинаково';
    $('res-text').textContent = `Через ${years} разница между сценариями всего ${formatMoneyShort(difference)}. Решайте по тому, что вам удобнее: свобода переезда или своё жильё.`;
  } else if (winner === 'rent') {
    $('res-title').textContent = 'Выгоднее снимать';
    $('res-text').textContent = `Если снимать квартиру и откладывать деньги на вклад, через ${years} у вас будет на ${formatMoneyShort(difference)} больше, чем при покупке в ипотеку.`;
  } else {
    $('res-title').textContent = 'Выгоднее покупать';
    $('res-text').textContent = `Если купить квартиру в ипотеку, через ${years} ваш капитал будет на ${formatMoneyShort(difference)} больше, чем если снимать и копить на вкладе.`;
  }

  $('res-rent').textContent = formatMoneyShort(r.rentCapital);
  $('res-buy').textContent = formatMoneyShort(r.buyCapital);
  let caption = r.balance > 1
    ? `квартира ${formatMoneyShort(r.flatValue)} минус долг ${formatMoneyShort(r.balance)}`
    : `квартира ${formatMoneyShort(r.flatValue)}, ипотека выплачена`;
  if (r.buySavings > 1000) caption += ` плюс накопления ${formatMoneyShort(r.buySavings)}`;
  $('res-buy-caption').textContent = caption;
  $('tile-rent').classList.toggle('tile--win', winner === 'rent');
  $('tile-buy').classList.toggle('tile--win', winner === 'buy');

  drawChart(r.rentSeries, r.buySeries, v.horizon);
  $('chart').setAttribute('aria-label',
    `График капитала по годам. Через ${years}: снимать — ${formatMoneyShort(r.rentCapital)}, покупать — ${formatMoneyShort(r.buyCapital)}.`);

  $('bd-payment').textContent = formatMoney(r.payment) + '/мес';
  $('bd-rent').textContent = formatMoney(v.rent) + '/мес';
  $('bd-interest-label').textContent = 'Проценты банку за ' + years;
  $('bd-interest').textContent = formatMoneyShort(r.interestPaid);
  $('bd-rent-paid-label').textContent = 'Потрачено на аренду за ' + years;
  $('bd-rent-paid').textContent = formatMoneyShort(r.rentPaid);
  $('bd-value').textContent = formatMoneyShort(r.flatValue);
  $('bd-balance').textContent = r.balance > 1 ? formatMoneyShort(r.balance) : 'ипотека выплачена';

  const b = r.breakeven;
  if (b.type === 'rate' && winner === 'rent') {
    $('insight-title').textContent = `Покупка станет выгоднее при ставке ниже ${rateFormat.format(b.rate)}%`;
    $('insight-text').textContent = 'Например, по льготной ипотечной программе. Остальные параметры — как сейчас.';
  } else if (b.type === 'rate') {
    $('insight-title').textContent = `Снимать станет выгоднее при ставке выше ${rateFormat.format(b.rate)}%`;
    $('insight-text').textContent = 'Остальные параметры — как сейчас.';
  } else if (b.type === 'never') {
    $('insight-title').textContent = 'Покупка не окупается даже при почти нулевой ставке';
    $('insight-text').textContent = 'Аренда слишком дешёвая относительно цены квартиры. Попробуйте увеличить срок сравнения.';
  } else {
    $('insight-title').textContent = 'Покупка выгоднее даже при ставке 50%';
    $('insight-text').textContent = 'Аренда здесь дорогая относительно цены квартиры.';
  }

  result.dataset.state = 'success';
  result.dataset.winner = winner;
  submitButton.textContent = 'Пересчитать';
  statusMessage.textContent = `Готово. ${$('res-title').textContent}, разница ${formatMoneyShort(difference)}.`;
}

function renderErrors(errors) {
  const names = Object.keys(errors);
  const count = names.length;

  errorList.innerHTML = '';
  for (const name of names) {
    const input = form.elements[name];
    const label = form.querySelector(`label[for="${input.id}"]`).textContent;

    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#' + input.id;
    const title = document.createElement('strong');
    title.textContent = label;
    const text = document.createElement('span');
    text.textContent = errors[name];
    const wrapper = document.createElement('div');
    wrapper.append(title, text);
    link.append(wrapper);
    item.append(link);
    errorList.append(item);
  }

  const marked = count % 10 === 1 && count % 100 !== 11 ? 'отмеченное' : 'отмеченных';
  $('error-text').textContent = `Исправьте ${count} ${plural(count, ['поле', 'поля', 'полей'])}, ${marked} красным, — и сразу покажем результат.`;

  if (names.some((name) => advanced.contains(form.elements[name]))) {
    advanced.open = true;
  }

  result.dataset.state = 'error';
  statusMessage.textContent = `Не получилось посчитать: ${count} ${plural(count, ['ошибка', 'ошибки', 'ошибок'])} в форме.`;
}

function niceStep(raw) {
  if (raw <= 0) return 1e6;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function formatAxis(value) {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e6) return rateFormat.format(value / 1e6) + ' млн';
  return rateFormat.format(value / 1e3) + ' тыс';
}

function drawChart(rentSeries, buySeries, horizon) {
  const X0 = 48, PLOT_W = 344, Y0 = 8, PLOT_H = 176;
  const all = [...rentSeries, ...buySeries];
  const minValue = Math.min(0, ...all);
  const maxValue = Math.max(...all);

  const step = niceStep((maxValue - minValue) / 4);
  const bottom = Math.floor(minValue / step) * step;
  const top = Math.max(Math.ceil(maxValue / step) * step, bottom + step);

  const x = (i) => X0 + (i * PLOT_W) / horizon;
  const y = (value) => Y0 + PLOT_H * (1 - (value - bottom) / (top - bottom));

  let svg = '';

  for (let tick = bottom; tick <= top + step / 2; tick += step) {
    const ty = y(tick).toFixed(1);
    const dashed = tick !== 0 ? ' chart__grid--dashed' : '';
    svg += `<line class="chart__grid${dashed}" x1="${X0}" y1="${ty}" x2="${X0 + PLOT_W}" y2="${ty}"/>`;
    svg += `<text class="chart__label" x="0" y="${(+ty + 4).toFixed(1)}">${formatAxis(tick)}</text>`;
  }

  const xTicks = horizon >= 4 ? [0, Math.round(horizon / 2), horizon] : [0, horizon];
  for (const i of xTicks) {
    const anchor = i === 0 ? 'start' : i === horizon ? 'end' : 'middle';
    const label = i === 0 ? 'сейчас' : formatYears(i);
    svg += `<text class="chart__label" x="${x(i).toFixed(1)}" y="208" text-anchor="${anchor}">${label}</text>`;
  }

  const line = (series, type) => {
    const points = series.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    const last = series.length - 1;
    return `<polyline class="chart__line chart__line--${type}" points="${points}"/>`
      + `<circle class="chart__dot chart__dot--${type}" cx="${x(last).toFixed(1)}" cy="${y(series[last]).toFixed(1)}" r="4.5"/>`;
  };
  svg += line(buySeries, 'buy') + line(rentSeries, 'rent');

  $('chart').innerHTML = svg;
}

function updateHorizon() {
  const input = form.elements.horizon;
  const value = Number(input.value);
  $('horizon-value').textContent = formatYears(value);
  const percent = ((value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', percent + '%');
}

function updateDownPaymentHint() {
  const price = parseNumber(form.elements.price.value);
  const down = parseNumber(form.elements.downPayment.value);
  const hint = $('down-payment-hint');
  const text = price > 0 && down >= 0 && down <= price
    ? `${Math.round((down / price) * 100)}% от стоимости квартиры`
    : 'Часть стоимости, которую платите сразу';
  hint.dataset.default = text;
  if (form.elements.downPayment.getAttribute('aria-invalid') !== 'true') {
    hint.textContent = text;
  }
}

function updateAdvancedPreview() {
  const value = (name) => form.elements[name].value.trim() || '—';
  advancedPreview.textContent =
    `Рост цен на жильё ${value('priceGrowth')}% · Рост аренды ${value('rentGrowth')}% · ` +
    `Вклад ${value('deposit')}% · Содержание ${value('upkeep')}% в год`;
}

function flashButton(button, text) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = original; }, 2000);
}

function saveToUrl(values) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) params.set(name, value);
  history.replaceState(null, '', '?' + params.toString());
}

function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has('price')) return false;

  for (const name of Object.keys(RULES)) {
    if (!params.has(name)) continue;
    const value = parseNumber(params.get(name));
    form.elements[name].value = MONEY_FIELDS.includes(name) && Number.isFinite(value)
      ? integerFormat.format(value)
      : params.get(name).replace('.', ',');
  }
  const term = form.querySelector(`input[name="term"][value="${params.get('term')}"]`);
  if (term) term.checked = true;
  if (params.has('horizon')) form.elements.horizon.value = params.get('horizon');
  return true;
}

function run() {
  const values = readForm();
  const errors = validate(values);
  showFieldErrors(errors);

  if (Object.keys(errors).length > 0) {
    renderErrors(errors);
  } else {
    render(calculate(values), values);
    saveToUrl(values);
  }

  if (window.matchMedia('(max-width: 1024px)').matches) {
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run();
});

form.addEventListener('input', (event) => {
  const input = event.target;

  if (input.classList.contains('field__input')) {
    const cleaned = input.value.replace(/[^\d\s.,\-−]/g, '');
    if (cleaned !== input.value) input.value = cleaned;
    clearFieldError(input);
  }
  if (input.name === 'horizon') updateHorizon();
  if (input.name === 'price' || input.name === 'downPayment') updateDownPaymentHint();
  if (advanced.contains(input)) updateAdvancedPreview();
});

for (const name of MONEY_FIELDS) {
  form.elements[name].addEventListener('blur', (event) => {
    const value = parseNumber(event.target.value);
    if (Number.isFinite(value)) event.target.value = integerFormat.format(value);
  });
}

errorList.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  const input = $(link.hash.slice(1));
  const details = input.closest('details');
  if (details) details.open = true;
  input.focus({ preventScroll: true });
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('reset').addEventListener('click', () => {
  for (const input of advanced.querySelectorAll('input')) {
    input.value = input.defaultValue;
    clearFieldError(input);
  }
  updateAdvancedPreview();
});

form.addEventListener('click', (event) => {
  const box = event.target.closest('.field__box');
  if (box && event.target === box) box.querySelector('input').focus();
});

$('print').addEventListener('click', () => window.print());

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

$('share').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const url = location.href;

  const canUseShareSheet = navigator.share && location.protocol.startsWith('http');
  if (canUseShareSheet) {
    try {
      await navigator.share({ title: document.title, url });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  const copied = await copyText(url);
  flashButton(button, copied ? 'Ссылка скопирована' : 'Не удалось скопировать');
});

for (const hint of form.querySelectorAll('.field__hint')) {
  hint.dataset.default = hint.textContent;
}

const hasSharedParams = loadFromUrl();
updateHorizon();
updateDownPaymentHint();
updateAdvancedPreview();
if (hasSharedParams) run();