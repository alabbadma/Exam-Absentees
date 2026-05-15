/* منصة معالجة أعذار الغياب عن الاختبارات
   واجهة GitHub Pages - الربط مع Google Apps Script
   غيّر قيمة API_URL بعد نشر Web App في Google Apps Script.
*/
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbw_n5sBb6x7dXeaJBXuc8m9_5w0wpQphvVwj_JtzJTvLVF9YzG96118egz1zbBqb2WV/exec",
  WEBMAIL_URL: "https://sts.moe.gov.sa/adfs/ls?wa=wsignin1.0&wtrealm=https%3a%2f%2fwebmail.moe.gov.sa%2fowa%2f&wctx=rm%3d0%26id%3dpassive%26ru%3d%252fowa%252f&wct=2024-03-22T10%3a40%3a34Z",
  API_TIMEOUT_MS: 60000,
  IMAGE_MAX_WIDTH: 1400,
  IMAGE_MAX_HEIGHT: 1400,
  IMAGE_QUALITY: 0.72
};

let SESSION = null;
let CURRENT_REQUESTS = [];
let CURRENT_ANALYTICS = null;
let ANALYTICS_LOADING = false;

function formatDateParts() {
  const now = new Date();
  const dayName = new Intl.DateTimeFormat('ar-SA', { weekday: 'long' }).format(now);
  // مهم: ar-SA قد يعرض التاريخ هجريًا في بعض المتصفحات، لذلك نحدد التقويم الميلادي صراحة.
  const greg = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { year: 'numeric', month: 'long', day: 'numeric' }).format(now);
  let hijri = '';
  try {
    hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { year: 'numeric', month: 'long', day: 'numeric' }).format(now);
  } catch (e) {
    hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { year: 'numeric', month: 'long', day: 'numeric' }).format(now);
  }
  const dn = document.getElementById('todayName');
  const gd = document.getElementById('gregDate');
  const hd = document.getElementById('hijriDate');
  if (dn) dn.textContent = dayName;
  if (gd) gd.textContent = 'ميلادي: ' + greg;
  if (hd) hd.textContent = 'هجري: ' + hijri;
}

formatDateParts();


const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function showToast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.style.background = isError ? "#991b1b" : "#10393a";
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4200);
}

function setButtonLoading(btn, isLoading, loadingText = "جاري التنفيذ...") {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("loading");
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${escapeHtml(loadingText)}</span>`;
  } else {
    btn.disabled = false;
    btn.classList.remove("loading");
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
    delete btn.dataset.originalHtml;
  }
}

async function withButtonLoading(btn, loadingText, task) {
  setButtonLoading(btn, true, loadingText);
  try {
    return await task((msg) => setButtonLoading(btn, true, msg || loadingText));
  } finally {
    setButtonLoading(btn, false);
  }
}

let LAST_SECTION = "publicHome";
let ACTIVE_DASH_TAB = "overview";
function showSection(sectionId) {
  const currentVisible = ["publicHome", "requestForm", "trackForm", "loginPanel", "dashboard"].find(id => !document.getElementById(id)?.classList.contains("hidden"));
  if (currentVisible && currentVisible !== sectionId) LAST_SECTION = currentVisible;
  ["publicHome", "requestForm", "trackForm", "loginPanel", "dashboard"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });
  document.getElementById(sectionId).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goBack() {
  if (LAST_SECTION && LAST_SECTION !== "dashboard") showSection(LAST_SECTION);
  else showSection("publicHome");
}

function goHome() {
  SESSION = null;
  showSection("publicHome");
}

async function api(action, payload = {}) {
  if (!CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_")) {
    throw new Error("لم يتم ضبط رابط Google Apps Script في ملف app.js.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS || 60000);
  let response;
  try {
    response = await fetch(CONFIG.API_URL, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("استغرق الاتصال وقتًا أطول من المتوقع. حاول مرة أخرى، أو قلّل حجم المرفقات.");
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("استجابة غير صالحة من الخادم: " + text.slice(0, 180));
  }

  if (!data.ok) throw new Error(data.message || "حدث خطأ غير معروف.");
  return data;
}

function formToObject(form) {
  const fd = new FormData(form);
  const obj = {};
  for (const [key, value] of fd.entries()) {
    if (value instanceof File) continue;
    obj[key] = value;
  }

  ["hasMedicalReport","isHospitalized","preventsAttendance","preventsExamPerformance","canRemoteExam","needsHealingPlaceExam"].forEach(name => {
    obj[name] = form.elements[name]?.checked ? "نعم" : "لا";
  });

  return obj;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذر قراءة الملف: " + file.name));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size || 0,
        data: result.includes(",") ? result.split(",")[1] : result,
      });
    };
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function compressImageFile(file) {
  if (!/^image\//.test(file.type || "")) return file;
  if (file.size <= 950 * 1024) return file;

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("تعذر ضغط الصورة: " + file.name));
    img.src = URL.createObjectURL(file);
  });

  let { width, height } = image;
  const maxW = CONFIG.IMAGE_MAX_WIDTH || 1400;
  const maxH = CONFIG.IMAGE_MAX_HEIGHT || 1400;
  const ratio = Math.min(1, maxW / width, maxH / height);
  width = Math.max(1, Math.round(width * ratio));
  height = Math.max(1, Math.round(height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(image.src);

  const outType = file.type === "image/png" ? "image/jpeg" : (file.type || "image/jpeg");
  const blob = await canvasToBlob(canvas, outType, CONFIG.IMAGE_QUALITY || 0.72);
  if (!blob || blob.size >= file.size) return file;
  const cleanName = file.name.replace(/\.(png|jpg|jpeg|webp)$/i, "") + "_compressed.jpg";
  return new File([blob], cleanName, { type: outType, lastModified: Date.now() });
}

async function collectFiles(input, onProgress) {
  const files = Array.from(input?.files || []);
  const maxFiles = 5;
  const maxBytes = 10 * 1024 * 1024;
  if (files.length > maxFiles) throw new Error(`الحد الأقصى للمرفقات هو ${maxFiles} ملفات.`);

  const output = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(`جاري تجهيز المرفق ${i + 1} من ${files.length}...`);
    const prepared = await compressImageFile(files[i]);
    if (prepared.size > maxBytes) throw new Error(`حجم الملف ${prepared.name} أكبر من 10 ميجابايت. فضلاً قلّل حجم الملف قبل رفعه.`);
    output.push(await fileToBase64(prepared));
  }
  return output;
}



const ARABIC_ORDINALS = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];

function toEnglishDigits(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

function enforceDigits(input, maxLength) {
  if (!input) return;
  input.addEventListener("input", () => {
    input.value = toEnglishDigits(input.value).replace(/\D/g, "").slice(0, maxLength);
  });
  input.addEventListener("paste", () => setTimeout(() => {
    input.value = toEnglishDigits(input.value).replace(/\D/g, "").slice(0, maxLength);
  }, 0));
}

function renderSubjectRows(count = 1) {
  const holder = document.getElementById("subjectDateRows");
  if (!holder) return;

  const current = Array.from(holder.querySelectorAll(".subject-date-row")).map(row => ({
    subject: row.querySelector("[data-subject]")?.value || "",
    date: row.querySelector("[data-exam-date]")?.value || "",
  }));

  const n = Math.max(1, Math.min(10, Number(count) || 1));
  holder.innerHTML = "";

  for (let i = 0; i < n; i++) {
    const row = document.createElement("div");
    row.className = "subject-date-row";
    row.dataset.index = String(i + 1);
    row.innerHTML = `
      <label class="subject-field">المادة ${ARABIC_ORDINALS[i] || (i + 1)}
        <input data-subject name="subject_${i + 1}" required placeholder="مثال: الرياضيات" value="${escapeAttr(current[i]?.subject || "")}" />
      </label>
      <label class="date-field">تاريخ الغياب / الاختبار
        <input data-exam-date name="examDate_${i + 1}" type="date" required value="${escapeAttr(current[i]?.date || "")}" />
      </label>
    `;
    holder.appendChild(row);
  }
}

function ensureSubjectRowsRendered() {
  const count = document.getElementById("absenceSubjectsCount");
  const holder = document.getElementById("subjectDateRows");
  if (!holder) return;
  const wanted = Math.max(1, Math.min(10, Number(count?.value || 1) || 1));
  const existing = holder.querySelectorAll(".subject-date-row").length;
  if (existing !== wanted) renderSubjectRows(wanted);
}

function collectSubjectDates(form) {
  ensureSubjectRowsRendered();
  const rows = Array.from(form.querySelectorAll(".subject-date-row"));
  const expectedCount = Number(document.getElementById("absenceSubjectsCount")?.value || rows.length || 1);
  const pairs = [];

  if (!rows.length) {
    renderSubjectRows(expectedCount);
  }

  const finalRows = Array.from(form.querySelectorAll(".subject-date-row"));
  for (let idx = 0; idx < finalRows.length; idx++) {
    const row = finalRows[idx];
    const subjectInput = row.querySelector("[data-subject]");
    const dateInput = row.querySelector("[data-exam-date]");
    const subject = subjectInput ? subjectInput.value.trim() : "";
    const date = dateInput ? dateInput.value : "";
    if (!subject || !date) {
      throw new Error(`يرجى تعبئة المادة ${ARABIC_ORDINALS[idx] || (idx + 1)} وتاريخ الغياب/الاختبار.`);
    }
    pairs.push({ subject, date });
  }

  if (pairs.length !== expectedCount) {
    throw new Error("عدد حقول المواد لا يطابق عدد مواد الغياب المختار. فضلاً اختر العدد مرة أخرى أو حدّث الصفحة.");
  }

  return {
    pairs,
    subjects: pairs.map(x => x.subject).join(" | "),
    examDate: pairs.map(x => `${x.subject}: ${x.date}`).join(" | "),
  };
}

function resetSubjectRows() {
  const count = $("#absenceSubjectsCount");
  if (count) count.value = "1";
  renderSubjectRows(1);
}

function initFormGuards() {
  enforceDigits(document.querySelector('[name="nationalId"]'), 10);
  enforceDigits(document.querySelector('[name="mobile"]'), 10);

  const count = document.getElementById("absenceSubjectsCount");
  if (count) {
    const handler = () => renderSubjectRows(count.value || 1);
    count.addEventListener("change", handler);
    count.addEventListener("input", handler);
    count.addEventListener("click", () => setTimeout(handler, 0));
    renderSubjectRows(count.value || 1);
  }
}

// احتياطي مهم: لو حمل المتصفح نسخة قديمة أو تأخر تحميل DOM، نعيد توليد حقول المواد بعد جاهزية الصفحة.
document.addEventListener("DOMContentLoaded", () => {
  initFormGuards();
  ensureSubjectRowsRendered();
});


document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    showSection(open.dataset.open);
    if (open.dataset.open === "requestForm") setTimeout(ensureSubjectRowsRendered, 80);
  }

  const login = e.target.closest("[data-login]");
  if (login) {
    // لا توجد صلاحيات دخول للمدرسة. الدخول محصور على إدارة تقويم الأداء المعرفي والمهاري.
    $("#loginTitle").textContent = "دخول إدارة تقويم الأداء المعرفي والمهاري";
    $("#loginForm [name=role]").value = "admin";
    showSection("loginPanel");
  }

  const tabBtn = e.target.closest("[data-dash-tab]");
  if (tabBtn) {
    setDashboardTab(tabBtn.dataset.dashTab);
  }

  if (e.target.closest("[data-home]")) goHome();
  if (e.target.closest("[data-back-home]")) goBack();
  if (e.target.closest("[data-dash-back]")) goBack();
});

ensureSubjectRowsRendered();

$("#newRequestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = e.submitter || form.querySelector("button[type=submit]");
  await withButtonLoading(btn, "جاري تجهيز الطلب...", async (progress) => {
    try {
      const request = formToObject(form);
      const subjectData = collectSubjectDates(form);
      request.subjects = subjectData.subjects;
      request.examDate = subjectData.examDate;
      request.subjectDatesJson = JSON.stringify(subjectData.pairs);

      if (!/^\d{10}$/.test(String(request.nationalId || ""))) throw new Error("رقم الهوية يجب أن يتكون من 10 أرقام فقط.");
      if (!/^05\d{8}$/.test(String(request.mobile || ""))) throw new Error("رقم الجوال يجب أن يتكون من 10 أرقام ويبدأ بـ 05.");
      if (!request.schoolEmail) throw new Error("بريد المدرسة الرسمي مطلوب لإشعار المدرسة بالقرار بعد اعتماده.");

      const attachments = await collectFiles(form.elements.attachments, progress);
      progress("جاري رفع المرفقات وحفظ المعاملة...");
      const result = await api("submitRequest", { request, attachments });
      showToast(`تم تقديم الطلب بنجاح. رقم الطلب: ${result.requestId}`);
      form.reset();
      resetSubjectRows();
      showSection("trackForm");
      $("#trackRequestForm [name=requestId]").value = result.requestId;
      $("#trackRequestForm [name=schoolCode]").value = request.schoolCode || "";
      $("#trackResult").innerHTML = `<b>رقم الطلب:</b> ${result.requestId}<br><span>يمكن للمدرسة متابعة الطلب باستخدام رقم الطلب والرقم الوزاري.</span>`;
    } catch (err) {
      showToast(err.message, true);
    }
  });
});

$("#trackRequestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.currentTarget.querySelector("button[type=submit]");
  await withButtonLoading(btn, "جاري الاستعلام...", async () => {
    $("#trackResult").textContent = "جاري الاستعلام...";
    try {
      const payload = formToObject(e.currentTarget);
      const result = await api("trackRequest", payload);
      const r = result.request;
      $("#trackResult").innerHTML = `
        <h3>نتيجة الاستعلام</h3>
        <p><b>رقم الطلب:</b> ${escapeHtml(r.requestId)}</p>
        <p><b>اسم الطالب/ـة:</b> ${escapeHtml(r.studentName)}</p>
        <p><b>المدرسة:</b> ${escapeHtml(r.schoolName)}</p>
        <p><b>حالة الطلب:</b> <span class="status-pill">${escapeHtml(r.status)}</span></p>
        <p><b>القرار المعتمد:</b> ${escapeHtml(r.finalDecision || "لم يعتمد بعد")}</p>
      `;
    } catch (err) {
      $("#trackResult").innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  });
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.currentTarget.querySelector("button[type=submit]");
  await withButtonLoading(btn, "جاري الدخول...", async () => {
    try {
      const payload = formToObject(e.currentTarget);
      payload.role = "admin";
      const result = await api("login", payload);
      SESSION = result.session;
      $("#roleLabel").textContent = "إدارة تقويم الأداء المعرفي والمهاري";
      showSection("dashboard");
      await loadDashboard();
    } catch (err) {
      showToast(err.message, true);
    }
  });
});

$("#logoutBtn").addEventListener("click", goHome);
$("#refreshBtn").addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري التحديث...", loadDashboard));
$("#refreshAnalyticsBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري تحديث الإحصاءات...", () => loadAnalytics(true)));

async function loadDashboard() {
  try {
    const tbody = $("#requestsTbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7">جاري تحميل البيانات...</td></tr>`;
    const result = await api("listRequests", { session: SESSION });
    CURRENT_REQUESTS = result.requests || [];
    CURRENT_ANALYTICS = null;
    renderKpis(result.kpis || {});
    applyDashboardTab();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderKpis(kpis) {
  $("#kpiNew").textContent = kpis.new || 0;
  $("#kpiReview").textContent = kpis.review || 0;
  $("#kpiComplete").textContent = kpis.complete || 0;
  $("#kpiApproved").textContent = kpis.approved || 0;
  $("#kpiRejected").textContent = kpis.rejected || 0;
}


function setDashboardTab(tab) {
  ACTIVE_DASH_TAB = tab || "overview";
  $$('[data-dash-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.dashTab === ACTIVE_DASH_TAB));
  applyDashboardTab();
}

function applyDashboardTab() {
  const title = $("#dashboardTableTitle");
  const tableCard = document.querySelector(".table-card");
  const analyticsPanel = $("#analyticsPanel");
  let rows = CURRENT_REQUESTS.slice();
  const tab = ACTIVE_DASH_TAB;

  if (analyticsPanel) analyticsPanel.classList.add("hidden");
  if (tableCard) tableCard.classList.remove("hidden");

  if (tab === "overview") {
    if (title) title.textContent = "أحدث الطلبات";
  } else if (tab === "requests") {
    if (title) title.textContent = "كل الطلبات";
  } else if (tab === "decisions") {
    rows = rows.filter(r => String(r.finalDecision || "").trim());
    if (title) title.textContent = "الطلبات ذات القرارات المعتمدة";
  } else if (tab === "reports") {
    if (tableCard) tableCard.classList.add("hidden");
    if (analyticsPanel) analyticsPanel.classList.remove("hidden");
    loadAnalytics(false);
    return;
  } else if (tab === "settings") {
    if (title) title.textContent = "الإعدادات - بيانات الطلبات";
    showToast("الإعدادات الأساسية تتم من Google Sheets حالياً.");
  }
  renderRequests(rows);
}

async function loadAnalytics(force = false) {
  if (ANALYTICS_LOADING) return;
  if (CURRENT_ANALYTICS && !force) {
    renderAnalytics(CURRENT_ANALYTICS);
    return;
  }
  const content = $("#analyticsContent");
  if (content) content.innerHTML = '<p class="muted">جاري تحميل الإحصاءات...</p>';
  ANALYTICS_LOADING = true;
  try {
    const result = await api("getAnalytics", { session: SESSION });
    CURRENT_ANALYTICS = result.analytics || {};
    renderAnalytics(CURRENT_ANALYTICS);
  } catch (err) {
    if (content) content.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  } finally {
    ANALYTICS_LOADING = false;
  }
}

function renderAnalytics(a) {
  const content = $("#analyticsContent");
  if (!content) return;
  const byDecision = a.byDecision || [];
  const byStage = a.byStage || [];
  const topSchools = a.topSchools || [];
  const maxDecision = Math.max(1, ...byDecision.map(x => Number(x.count || 0)));
  const maxStage = Math.max(1, ...byStage.map(x => Number(x.count || 0)));
  const maxSchools = Math.max(1, ...topSchools.map(x => Number(x.count || 0)));

  content.innerHTML = `
    <div class="analytics-kpis">
      <article><b>${escapeHtml(a.totalRequests || 0)}</b><span>إجمالي الطلبات</span></article>
      <article><b>${escapeHtml(a.executed || 0)}</b><span>طلبات منفذة / معتمدة</span></article>
      <article><b>${escapeHtml(a.pending || 0)}</b><span>لم تنفذ بعد</span></article>
      <article><b>${escapeHtml(a.schoolsCount || 0)}</b><span>عدد المدارس الرافعة</span></article>
      <article><b>${escapeHtml(a.totalAbsenceSubjects || 0)}</b><span>إجمالي مواد الغياب</span></article>
      <article><b>${escapeHtml(a.todayRequests || 0)}</b><span>طلبات اليوم</span></article>
    </div>
    <div class="analytics-grid">
      <section class="chart-box">
        <h3>القرارات المعتمدة حسب النوع</h3>
        ${renderBarList(byDecision, maxDecision)}
      </section>
      <section class="chart-box">
        <h3>الطلبات حسب المرحلة</h3>
        ${renderBarList(byStage, maxStage)}
      </section>
      <section class="chart-box">
        <h3>أكثر المدارس رفعًا للطلبات</h3>
        ${renderBarList(topSchools, maxSchools)}
      </section>
      <section class="chart-box">
        <h3>مؤشرات تنفيذ الطلبات</h3>
        <div class="donut-wrap">
          <div class="donut" style="--done:${Number(a.executionPercent || 0)}"><span>${escapeHtml(a.executionPercent || 0)}%</span></div>
          <div class="legend-mini">
            <span>منفذة: ${escapeHtml(a.executed || 0)}</span>
            <span>لم تنفذ: ${escapeHtml(a.pending || 0)}</span>
            <span>آخر تحديث: ${escapeHtml(a.generatedAt || "")}</span>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderBarList(items, max) {
  if (!items || !items.length) return '<p class="muted">لا توجد بيانات كافية.</p>';
  return `<div class="bar-list">${items.map(item => {
    const pct = Math.max(4, Math.round((Number(item.count || 0) / max) * 100));
    return `<div class="bar-row"><span>${escapeHtml(item.label || "غير محدد")}</span><b>${escapeHtml(item.count || 0)}</b><i style="width:${pct}%"></i></div>`;
  }).join("")}</div>`;
}

function renderRequests(rows) {
  const tbody = $("#requestsTbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">لا توجد طلبات حالياً.</td></tr>`;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.requestId)}</td>
      <td>${escapeHtml(row.studentName)}</td>
      <td>${escapeHtml(row.schoolName)}</td>
      <td><span class="status-pill">${escapeHtml(row.status)}</span></td>
      <td>${SESSION.role === "admin" ? escapeHtml(row.systemDecision || "") : "لا يظهر قبل الاعتماد"}</td>
      <td>${escapeHtml(row.finalDecision || "")}</td>
      <td class="row-actions">
        <button class="small-btn" data-view="${escapeAttr(row.requestId)}">عرض</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $$("[data-view]").forEach(btn => btn.addEventListener("click", () => withButtonLoading(btn, "جاري الفتح...", () => openDetails(btn.dataset.view))));
}

async function openDetails(requestId) {
  try {
    const result = await api("getRequest", { session: SESSION, requestId });
    renderDetails(result.request);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderDetails(r) {
  const details = $("#requestDetails");
  details.classList.remove("hidden");

  const adminTools = SESSION.role === "admin" ? `
    <hr>
    <h2>قرار النظام الأولي والاعتماد</h2>
    <div class="details-grid">
      <div class="info-box"><b>قرار النظام الأولي</b><span>${escapeHtml(r.systemDecision || "")}</span></div>
      <div class="info-box"><b>درجة الثقة</b><span>${escapeHtml(r.confidence || "")}</span></div>
      <div class="info-box"><b>مبررات القرار</b><span>${escapeHtml(r.systemReasons || "")}</span></div>
    </div>
    <div class="decision-tools">
      <select id="finalDecisionSelect">
        ${["اختبار بديل","اختبار عن بعد","اختبار في مكان الاستشفاء","استكمال المستندات","رفض العذر","رفع للدراسة اليدوية"].map(d => `<option ${r.finalDecision===d?"selected":""}>${d}</option>`).join("")}
      </select>
      <textarea id="directorNote" placeholder="سبب التعديل أو ملاحظات المدير">${escapeHtml(r.directorNote || "")}</textarea>
      <input id="ccEmails" placeholder="CC اختياري - أكثر من بريد مفصول بفاصلة" />
      <button class="submit-btn" type="button" id="approveBtn">اعتماد القرار</button>
      <button class="ghost-btn" type="button" id="pdfBtn">توليد PDF</button>
      <button class="ghost-btn" type="button" id="emlBtn">تجهيز البريد الرسمي</button>
    </div>
  ` : "";

  details.innerHTML = `
    <div class="panel-head">
      <h2>تفاصيل الطلب: ${escapeHtml(r.requestId)}</h2>
      <div class="panel-actions"><button class="ghost-btn" type="button" onclick="document.getElementById('requestDetails').classList.add('hidden')">إغلاق</button><button class="ghost-btn" type="button" data-home>الصفحة الرئيسية</button></div>
    </div>
    <div class="details-grid">
      <div class="info-box"><b>اسم الطالب/ـة</b><span>${escapeHtml(r.studentName)}</span></div>
      <div class="info-box"><b>رقم الهوية</b><span>${escapeHtml(r.nationalId)}</span></div>
      <div class="info-box"><b>المدرسة</b><span>${escapeHtml(r.schoolName)}</span></div>
      <div class="info-box"><b>المرحلة / الصف</b><span>${escapeHtml(r.stage)} - ${escapeHtml(r.grade)}</span></div>
      <div class="info-box"><b>المواد</b><span>${escapeHtml(r.subjects)}</span></div>
      <div class="info-box"><b>تواريخ الاختبارات</b><span>${escapeHtml(r.examDate)}</span></div>
      <div class="info-box"><b>تصنيف الحالة</b><span>${escapeHtml(r.medicalCategory)}</span></div>
      <div class="info-box"><b>وصف الحالة</b><span>${escapeHtml(r.medicalDescription)}</span></div>
      <div class="info-box"><b>رابط التقرير الطبي</b><span>${linkOrDash(r.medicalReportUrl)}</span></div>
    </div>
    ${adminTools}
  `;

  $("#approveBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري الاعتماد...", async () => {
    try {
      const finalDecision = $("#finalDecisionSelect").value;
      const directorNote = $("#directorNote").value;
      const result = await api("approveDecision", { session: SESSION, requestId: r.requestId, finalDecision, directorNote });
      showToast(result.message);
      await openDetails(r.requestId);
      await loadDashboard();
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $("#pdfBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري توليد PDF...", async () => {
    try {
      const result = await api("generatePdf", { session: SESSION, requestId: r.requestId });
      showToast("تم توليد ملف PDF.");
      if (result.pdfUrl) window.open(result.pdfUrl, "_blank");
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $("#emlBtn")?.addEventListener("click", (e) => {
    const emlWindow = window.open("about:blank", "_blank");
    const mailWindow = window.open("about:blank", "_blank");
    return withButtonLoading(e.currentTarget, "جاري تجهيز البريد...", async () => {
      try {
        const result = await api("generateOutlookEml", {
          session: SESSION,
          requestId: r.requestId,
          cc: $("#ccEmails")?.value || ""
        });
        showToast("تم تجهيز البريد الرسمي. تم تحميل PDF ونسخ نص الرسالة.");
        if (emlWindow) emlWindow.location = result.pdfDownloadUrl || result.pdfUrl;
        if (mailWindow) mailWindow.location = result.webmailUrl || CONFIG.WEBMAIL_URL;
        await copyPreparedText(result.body || "");
        showMailPreparationPanel(result);
      } catch (err) {
        if (emlWindow) emlWindow.close();
        if (mailWindow) mailWindow.close();
        showToast(err.message, true);
      }
    });
  });
}

async function copyPreparedText(text) {
  try {
    await navigator.clipboard.writeText(text || "");
    return true;
  } catch (e) {
    return false;
  }
}

function showMailPreparationPanel(result) {
  let box = document.getElementById("mailPrepBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "mailPrepBox";
    box.className = "mail-prep-box";
    const details = document.getElementById("requestDetails");
    if (details) details.appendChild(box);
  }
  box.innerHTML = `
    <h2>تم تجهيز البريد الرسمي</h2>
    <p class="mail-note">تم توليد ملف PDF للمعاملة كاملة، وتمت محاولة تحميله ونسخ نص الرسالة. بعد الدخول على بريد الوزارة أنشئ رسالة جديدة ثم استخدم الأزرار التالية للنسخ والإرفاق.</p>
    <div class="mail-grid">
      <label>إلى<input id="preparedTo" readonly value="${escapeAttr(result.to || "")}" /></label>
      <label>CC<input id="preparedCc" readonly value="${escapeAttr(result.cc || "")}" /></label>
      <label class="wide">الموضوع<input id="preparedSubject" readonly value="${escapeAttr(result.subject || "")}" /></label>
      <label class="wide">نص الرسالة<textarea id="preparedBody" readonly>${escapeHtml(result.body || "")}</textarea></label>
      <label class="wide">ملف PDF المطلوب إرفاقه<input readonly value="${escapeAttr(result.pdfFileName || "ملف المعاملة PDF")}" /></label>
    </div>
    <div class="mail-actions">
      <button class="submit-btn" type="button" data-copy="preparedTo">نسخ بريد المدرسة</button>
      <button class="submit-btn" type="button" data-copy="preparedCc">نسخ CC</button>
      <button class="submit-btn" type="button" data-copy="preparedSubject">نسخ الموضوع</button>
      <button class="submit-btn" type="button" data-copy="preparedBody">نسخ نص الرسالة</button>
      <a class="submit-btn link-button" href="${escapeAttr(result.pdfDownloadUrl || result.pdfUrl || "#")}" target="_blank" rel="noopener">تحميل PDF المعاملة</a>
      <a class="submit-btn link-button" href="${escapeAttr(result.webmailUrl || CONFIG.WEBMAIL_URL)}" target="_blank" rel="noopener">فتح بريد الوزارة</a>
    </div>
  `;
  box.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const el = document.getElementById(btn.dataset.copy);
      const ok = await copyPreparedText(el?.value || el?.textContent || "");
      showToast(ok ? "تم النسخ." : "لم يتم النسخ تلقائيًا، انسخ النص يدويًا.", !ok);
    });
  });
}

function linkOrDash(url) {
  if (!url) return "—";
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">فتح الملف</a>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }
