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

const DASH_CACHE_KEY = "examAbsentees.dashboard.v16";
const ANALYTICS_CACHE_KEY = "examAbsentees.analytics.v16";

function readLocalCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.time) return null;
    return obj;
  } catch (e) { return null; }
}

function writeLocalCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
  } catch (e) {}
}

function cacheAgeLabel(cache) {
  if (!cache || !cache.time) return "";
  const sec = Math.max(0, Math.round((Date.now() - cache.time) / 1000));
  if (sec < 60) return `آخر تحديث قبل ${sec} ثانية`;
  const min = Math.round(sec / 60);
  return `آخر تحديث قبل ${min} دقيقة`;
}

function toLatinDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
    .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)]);
}

function formatDateParts() {
  const now = new Date();
  const dayName = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { weekday: 'long' }).format(now);
  // مهم: ar-SA قد يعرض التاريخ هجريًا في بعض المتصفحات، لذلك نحدد التقويم الميلادي صراحة.
  const greg = toLatinDigits(new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }).format(now));
  let hijri = '';
  try {
    hijri = toLatinDigits(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }).format(now));
  } catch (e) {
    hijri = toLatinDigits(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }).format(now));
  }
  const dn = document.getElementById('todayName');
  const gd = document.getElementById('gregDate');
  const hd = document.getElementById('hijriDate');
  if (dn) dn.textContent = toLatinDigits(dayName);
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

  ["hasMedicalReport","preventsAttendance","preventsExamPerformance","canRemoteExam","needsHealingPlaceExam"].forEach(name => {
    obj[name] = form.elements[name]?.checked ? "نعم" : "لا";
  });

  const natSelect = form.querySelector('[name="nationality"]');
  const natOther = form.querySelector('[name="nationalityOther"]');
  if (natSelect && natSelect.value === "أخرى") {
    obj.nationality = (natOther?.value || "").trim();
  }
  const hosp = form.querySelector('[name="hospitalizationStatus"]')?.value || "لا يوجد تنويم في المستشفى";
  obj.hospitalizationStatus = hosp;
  obj.isHospitalized = hosp === "لا يوجد تنويم في المستشفى" ? "لا" : "نعم";
  obj.hospitalDays = form.querySelector('[name="hospitalDays"]')?.value || "";
  obj.hospitalFrom = form.querySelector('[name="hospitalFrom"]')?.value || "";
  obj.hospitalTo = form.querySelector('[name="hospitalTo"]')?.value || "";

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

const NATIONALITIES = [
  "المملكة العربية السعودية",
  "الإمارات العربية المتحدة", "مملكة البحرين", "دولة الكويت", "سلطنة عمان", "دولة قطر",
  "الجمهورية اليمنية", "جمهورية العراق", "المملكة الأردنية الهاشمية", "دولة فلسطين", "الجمهورية اللبنانية", "الجمهورية العربية السورية",
  "جمهورية مصر العربية", "جمهورية السودان", "دولة ليبيا", "الجمهورية التونسية", "الجمهورية الجزائرية الديمقراطية الشعبية", "المملكة المغربية", "الجمهورية الإسلامية الموريتانية", "جمهورية الصومال", "جمهورية جيبوتي", "جزر القمر", "أخرى"
];

const GRADES_BY_STAGE = {
  "الابتدائية": ["الصف الأول ابتدائي", "الصف الثاني ابتدائي", "الصف الثالث ابتدائي", "الصف الرابع ابتدائي", "الصف الخامس ابتدائي", "الصف السادس ابتدائي"],
  "المتوسطة": ["الصف الأول متوسط", "الصف الثاني متوسط", "الصف الثالث متوسط"],
  "الثانوية": ["الصف الأول ثانوي", "الصف الثاني ثانوي", "الصف الثالث ثانوي"],
};

const SUBJECTS_BY_STAGE = {
  "الابتدائية": ["القرآن الكريم", "التوحيد", "الفقه والسلوك", "الحديث والسيرة", "لغتي", "الرياضيات", "العلوم", "الدراسات الاجتماعية", "المهارات الرقمية", "اللغة الإنجليزية", "التربية الفنية", "التربية البدنية", "المهارات الحياتية والأسرية", "أخرى"],
  "المتوسطة": ["القرآن الكريم", "التوحيد", "الفقه", "الحديث", "لغتي الخالدة", "الرياضيات", "العلوم", "الدراسات الاجتماعية", "المهارات الرقمية", "اللغة الإنجليزية", "التربية الفنية", "التربية البدنية", "التفكير الناقد", "أخرى"],
  "الثانوية": ["الكفايات اللغوية", "اللغة الإنجليزية", "الرياضيات", "الأحياء", "الكيمياء", "الفيزياء", "علم البيئة", "الدراسات الإسلامية", "التاريخ", "الجغرافيا", "المهارات الرقمية", "التفكير الناقد", "إدارة الأعمال", "المهارات الحياتية", "التربية الصحية والبدنية", "أخرى"]
};

function getCurrentStage() {
  return document.querySelector('[name="stage"]')?.value || "الابتدائية";
}

function getSubjectOptionsForCurrentStage() {
  return SUBJECTS_BY_STAGE[getCurrentStage()] || SUBJECTS_BY_STAGE["الابتدائية"];
}

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
    subject: row.querySelector("[data-subject]")?.value || row.querySelector("[data-subject-select]")?.value || "",
    other: row.querySelector("[data-subject-other]")?.value || "",
    date: row.querySelector("[data-exam-date]")?.value || "",
  }));

  const n = Math.max(1, Math.min(10, Number(count) || 1));
  const options = getSubjectOptionsForCurrentStage();
  holder.innerHTML = "";

  for (let i = 0; i < n; i++) {
    const prevSubject = current[i]?.subject || "";
    const prevOther = current[i]?.other || "";
    const selected = options.includes(prevSubject) ? prevSubject : (prevSubject ? "أخرى" : options[0]);
    const otherValue = selected === "أخرى" ? (prevOther || (options.includes(prevSubject) ? "" : prevSubject)) : "";
    const row = document.createElement("div");
    row.className = "subject-date-row";
    row.dataset.index = String(i + 1);
    row.innerHTML = `
      <label class="subject-field">المادة ${ARABIC_ORDINALS[i] || (i + 1)}
        <select data-subject-select name="subject_${i + 1}_select" required>
          ${options.map(opt => `<option value="${escapeAttr(opt)}" ${opt === selected ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join("")}
        </select>
        <div class="subject-other-wrap ${selected === "أخرى" ? "" : "hidden"}">
          <input data-subject-other name="subject_${i + 1}_other" placeholder="اكتب اسم المادة" value="${escapeAttr(otherValue)}" />
        </div>
        <input data-subject type="hidden" name="subject_${i + 1}" value="${escapeAttr(selected === "أخرى" ? otherValue : selected)}" />
      </label>
      <label class="date-field">تاريخ الغياب / الاختبار
        <input data-exam-date name="examDate_${i + 1}" type="date" required value="${escapeAttr(current[i]?.date || "")}" />
      </label>
    `;
    holder.appendChild(row);
    syncSubjectRow(row);
  }
}

function syncSubjectRow(row) {
  const sel = row.querySelector("[data-subject-select]");
  const otherWrap = row.querySelector(".subject-other-wrap");
  const other = row.querySelector("[data-subject-other]");
  const hidden = row.querySelector("[data-subject]");
  const sync = () => {
    const isOther = sel?.value === "أخرى";
    otherWrap?.classList.toggle("hidden", !isOther);
    if (other) other.required = !!isOther;
    if (hidden) hidden.value = isOther ? (other?.value || "").trim() : (sel?.value || "");
  };
  sel?.addEventListener("change", sync);
  other?.addEventListener("input", sync);
  sync();
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

  if (!rows.length) renderSubjectRows(expectedCount);

  const finalRows = Array.from(form.querySelectorAll(".subject-date-row"));
  for (let idx = 0; idx < finalRows.length; idx++) {
    const row = finalRows[idx];
    syncSubjectRow(row);
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
    semester: document.getElementById("semesterSelect")?.value || "",
  };
}

function resetSubjectRows() {
  const count = $("#absenceSubjectsCount");
  if (count) count.value = "1";
  const semester = $("#semesterSelect");
  if (semester) semester.value = "الفصل الدراسي الأول";
  renderSubjectRows(1);
}


function initNationalitySelect() {
  const select = document.getElementById("nationalitySelect");
  const wrap = document.getElementById("otherNationalityWrap");
  const other = document.getElementById("nationalityOther");
  if (!select) return;
  if (!select.options.length) {
    select.innerHTML = NATIONALITIES.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join("");
  }
  const sync = () => {
    const isOther = select.value === "أخرى";
    wrap?.classList.toggle("hidden", !isOther);
    if (other) other.required = isOther;
  };
  select.addEventListener("change", sync);
  sync();
}

function initStageGradeSelect() {
  const stage = document.querySelector('[name="stage"]');
  const grade = document.getElementById("gradeSelect");
  if (!stage || !grade) return;
  const sync = () => {
    const current = grade.value;
    const list = GRADES_BY_STAGE[stage.value] || [];
    grade.innerHTML = list.map(g => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join("");
    if (list.includes(current)) grade.value = current;
    renderSubjectRows(document.getElementById("absenceSubjectsCount")?.value || 1);
  };
  stage.addEventListener("change", sync);
  sync();
}

function initHospitalizationFields() {
  const status = document.getElementById("hospitalizationStatus");
  const box = document.getElementById("hospitalDetails");
  const days = document.getElementById("hospitalDays");
  const from = document.getElementById("hospitalFrom");
  const to = document.getElementById("hospitalTo");
  const remote = document.querySelector('[name="canRemoteExam"]');
  const healing = document.querySelector('[name="needsHealingPlaceExam"]');
  if (!status || !box) return;

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const calcDays = () => {
    if (!days) return;
    const hasHosp = status.value !== "لا يوجد تنويم في المستشفى";
    if (!hasHosp) { days.value = ""; return; }
    const start = from?.value;
    const end = status.value === "تم التنويم ولا يزال حتى تاريخه" ? todayIso() : (to?.value || "");
    if (!start || !end) { days.value = ""; return; }
    const sDate = new Date(start + "T00:00:00");
    const eDate = new Date(end + "T00:00:00");
    if (isNaN(sDate) || isNaN(eDate) || eDate < sDate) { days.value = ""; return; }
    const diff = Math.floor((eDate - sDate) / 86400000) + 1;
    days.value = String(Math.max(1, Math.min(999, diff)));
  };

  const sync = () => {
    const hasHosp = status.value !== "لا يوجد تنويم في المستشفى";
    box.classList.toggle("hidden", !hasHosp);
    if (days) days.required = hasHosp;
    if (from) from.required = hasHosp;
    if (to) {
      const still = status.value === "تم التنويم ولا يزال حتى تاريخه";
      to.required = hasHosp && !still;
      to.disabled = still;
      if (still) to.value = todayIso();
      if (!hasHosp) to.value = "";
    }
    if (!hasHosp) {
      if (from) from.value = "";
    }
    calcDays();
  };

  const enforceExclusive = (source) => {
    if (source === remote && remote?.checked && healing) healing.checked = false;
    if (source === healing && healing?.checked && remote) remote.checked = false;
  };
  remote?.addEventListener("change", () => enforceExclusive(remote));
  healing?.addEventListener("change", () => enforceExclusive(healing));

  from?.addEventListener("change", calcDays);
  to?.addEventListener("change", calcDays);
  status.addEventListener("change", sync);
  sync();
}

function initFormGuards() {
  enforceDigits(document.querySelector('[name="nationalId"]'), 10);
  enforceDigits(document.querySelector('[name="mobile"]'), 10);
  initNationalitySelect();
  initStageGradeSelect();
  initHospitalizationFields();

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
      request.semester = subjectData.semester;

      if (!request.nationality) throw new Error("فضلاً اختر الجنسية أو اكتبها عند اختيار أخرى.");
      if (request.hospitalizationStatus !== "لا يوجد تنويم في المستشفى") {
        if (!request.hospitalFrom) throw new Error("تاريخ بداية التنويم مطلوب عند وجود تنويم.");
        if (request.hospitalizationStatus === "تم التنويم ثم الخروج من المستشفى" && !request.hospitalTo) throw new Error("تاريخ نهاية التنويم مطلوب عند الخروج من المستشفى.");
        if (!request.hospitalDays || Number(request.hospitalDays) < 1) throw new Error("تعذر احتساب مدة التنويم. فضلاً تحقق من تاريخ البداية والنهاية.");
      }
      if (request.canRemoteExam === "نعم" && request.needsHealingPlaceExam === "نعم") {
        throw new Error("لا يمكن اختيار اختبار عن بعد واختبار في مكان الاستشفاء في نفس الوقت؛ اختر خيارًا واحدًا فقط.");
      }

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
      loadDashboard({ useCache: true, background: false });
    } catch (err) {
      showToast(err.message, true);
    }
  });
});

$("#logoutBtn").addEventListener("click", goHome);
$("#refreshBtn").addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري التحديث...", () => loadDashboard({ useCache: false, background: false })));
$("#refreshAnalyticsBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري تحديث الإحصاءات...", () => loadAnalytics(true)));

async function loadDashboard(options = {}) {
  const useCache = options.useCache !== false;
  const tbody = $("#requestsTbody");
  const cached = useCache ? readLocalCache(DASH_CACHE_KEY) : null;

  if (cached && cached.data) {
    CURRENT_REQUESTS = cached.data.requests || [];
    renderKpis(cached.data.kpis || {});
    applyDashboardTab();
    showToast(cacheAgeLabel(cached) + " — جاري تحديث البيانات في الخلفية...");
  } else if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7">جاري تحميل البيانات...</td></tr>`;
  }

  try {
    const result = await api("listRequests", { session: SESSION });
    CURRENT_REQUESTS = result.requests || [];
    CURRENT_ANALYTICS = null;
    const payload = { requests: CURRENT_REQUESTS, kpis: result.kpis || {} };
    writeLocalCache(DASH_CACHE_KEY, payload);
    renderKpis(payload.kpis);
    applyDashboardTab();
  } catch (err) {
    if (!cached) showToast(err.message, true);
    else showToast("تعذر تحديث البيانات الآن، وتم عرض آخر نسخة محفوظة مؤقتًا.", true);
  }
}

function renderKpis(kpis) {
  $("#kpiNew").textContent = toLatinDigits(kpis.new || 0);
  $("#kpiReview").textContent = toLatinDigits(kpis.review || 0);
  $("#kpiComplete").textContent = toLatinDigits(kpis.complete || 0);
  $("#kpiApproved").textContent = toLatinDigits(kpis.approved || 0);
  $("#kpiRejected").textContent = toLatinDigits(kpis.rejected || 0);
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
  const cached = !force ? readLocalCache(ANALYTICS_CACHE_KEY) : null;
  const content = $("#analyticsContent");
  if (cached && cached.data) {
    CURRENT_ANALYTICS = cached.data;
    renderAnalytics(CURRENT_ANALYTICS);
    showToast(cacheAgeLabel(cached) + " — جاري تحديث الإحصاءات في الخلفية...");
  } else if (content) {
    content.innerHTML = '<p class="muted">جاري تحميل الإحصاءات...</p>';
  }
  ANALYTICS_LOADING = true;
  try {
    const result = await api("getAnalytics", { session: SESSION });
    CURRENT_ANALYTICS = result.analytics || {};
    writeLocalCache(ANALYTICS_CACHE_KEY, CURRENT_ANALYTICS);
    renderAnalytics(CURRENT_ANALYTICS);
  } catch (err) {
    if (content && !cached) content.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    if (cached) showToast("تعذر تحديث الإحصاءات الآن، وتم عرض آخر نسخة محفوظة مؤقتًا.", true);
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
      <article><b>${escapeHtml(a.totalStudents || 0)}</b><span>إجمالي الطلاب</span></article>
      <article><b>${escapeHtml(a.maleStudents || 0)}</b><span>طلاب</span></article>
      <article><b>${escapeHtml(a.femaleStudents || 0)}</b><span>طالبات</span></article>
      <article><b>${escapeHtml(a.primarySchools || 0)}</b><span>مدارس ابتدائية</span></article>
      <article><b>${escapeHtml(a.middleSchools || 0)}</b><span>مدارس متوسطة</span></article>
      <article><b>${escapeHtml(a.highSchools || 0)}</b><span>مدارس ثانوية</span></article>
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
        <h3>الطلاب حسب الجنس</h3>
        ${renderBarList(a.byGender || [], Math.max(1, ...(a.byGender || []).map(x => Number(x.count || 0))))}
      </section>
      <section class="chart-box">
        <h3>المدارس الرافعة حسب المرحلة</h3>
        ${renderBarList(a.schoolsByStage || [], Math.max(1, ...(a.schoolsByStage || []).map(x => Number(x.count || 0))))}
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

function renderEmailStatus(status) {
  const value = String(status || "لم يتم التجهيز");
  let cls = "pending";
  if (value.includes("تم إبلاغ") || value.includes("مرسل") || value.includes("تم الإرسال")) cls = "sent";
  else if (value.includes("تجهيز") || value.includes("جاهز")) cls = "ready";
  return `<span class="email-status-pill ${cls}">${escapeHtml(value)}</span>`;
}

function renderRequests(rows) {
  const tbody = $("#requestsTbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">لا توجد طلبات حالياً.</td></tr>`;
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
      <td>${renderEmailStatus(row.emailNotifyStatus || row.outlookStatus || "لم يتم التجهيز")}</td>
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

    <div class="translation-card">
      <h2>إدارة ترجمة التقرير الطبي</h2>
      <p class="translation-note">تظهر هنا الترجمة الآلية المساعدة للتقرير الطبي الإنجليزي. يمكن لصاحب الصلاحية تعديلها قبل حفظها أو اعتمادها، ولا تغني عن مراجعة التقرير الأصلي.</p>
      <div class="translation-status"><b>حالة الترجمة:</b> <span id="translationStatusText">${escapeHtml(r.translationStatus || "غير مترجمة")}</span></div>
      <div class="translation-actions">
        <button class="ghost-btn" type="button" id="openOriginalReportBtn">فتح التقرير الأصلي</button>
        <button class="submit-btn" type="button" id="translateReportBtn">ترجمة التقرير</button>
        <button class="submit-btn" type="button" id="saveTranslationBtn">حفظ الترجمة</button>
        <button class="submit-btn" type="button" id="approveTranslationBtn">اعتماد الترجمة</button>
      </div>
      <div class="translation-grid">
        <label>النص الإنجليزي المستخرج
          <textarea id="extractedEnglishText" placeholder="سيظهر النص الإنجليزي المستخرج من التقرير هنا...">${escapeHtml(r.extractedEnglishText || "")}</textarea>
        </label>
        <label>الترجمة العربية القابلة للتعديل
          <textarea id="arabicTranslationText" placeholder="ستظهر الترجمة العربية هنا ويمكن تعديلها قبل الاعتماد.">${escapeHtml(r.arabicTranslation || "")}</textarea>
        </label>
      </div>
    </div>
    <div class="decision-tools">
      <select id="finalDecisionSelect">
        ${["اختبار بديل","اختبار عن بعد","اختبار في مكان الاستشفاء","استكمال المستندات","رفض العذر","رفع للدراسة اليدوية"].map(d => `<option ${r.finalDecision===d?"selected":""}>${d}</option>`).join("")}
      </select>
      <textarea id="directorNote" placeholder="سبب التعديل أو ملاحظات المدير">${escapeHtml(r.directorNote || "")}</textarea>
      <input id="ccEmails" placeholder="CC اختياري - أكثر من بريد مفصول بفاصلة" />
      <button class="submit-btn" type="button" id="approveBtn">اعتماد القرار</button>
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
      <div class="info-box"><b>الجنس / الجنسية</b><span>${escapeHtml((r.gender || "") + " - " + (r.nationality || ""))}</span></div>
      <div class="info-box"><b>الفصل الدراسي</b><span>${escapeHtml(r.semester || "")}</span></div>
      <div class="info-box"><b>المواد</b><span>${escapeHtml(r.subjects)}</span></div>
      <div class="info-box"><b>تواريخ الاختبارات</b><span>${escapeHtml(r.examDate)}</span></div>
      <div class="info-box"><b>تصنيف الحالة</b><span>${escapeHtml(r.medicalCategory)}</span></div>
      <div class="info-box"><b>حالة التنويم</b><span>${escapeHtml(r.hospitalizationStatus || "")}</span></div>
      <div class="info-box"><b>مدة التنويم</b><span>${escapeHtml(r.hospitalDays || "")}</span></div>
      <div class="info-box"><b>وصف الحالة</b><span>${escapeHtml(r.medicalDescription)}</span></div>
      <div class="info-box"><b>رابط التقرير الطبي</b><span>${linkOrDash(r.medicalReportUrl)}</span></div>
      <div class="info-box"><b>حالة الإبلاغ بالبريد</b><span>${renderEmailStatus(r.emailNotifyStatus || r.outlookStatus || "لم يتم التجهيز")}</span></div>
    </div>
    ${adminTools}
  `;

  $("#approveBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري الاعتماد...", async () => {
    try {
      const finalDecision = $("#finalDecisionSelect").value;
      const directorNote = $("#directorNote").value;
      const result = await api("approveDecision", { session: SESSION, requestId: r.requestId, finalDecision, directorNote });
      showToast(result.message);
      // تحديث بصري فوري ثم مزامنة الخلفية
      const statusBox = Array.from(document.querySelectorAll(".info-box b")).find(b => b.textContent.includes("حالة الإبلاغ"))?.parentElement;
      if (statusBox) statusBox.querySelector("span").innerHTML = renderEmailStatus("لم يتم التجهيز");
      loadDashboard({ useCache: false, background: true });
      openDetails(r.requestId).catch(()=>{});
    } catch (err) {
      showToast(err.message, true);
    }
  }));


  $("#openOriginalReportBtn")?.addEventListener("click", () => {
    if (r.medicalReportUrl) window.open(r.medicalReportUrl, "_blank", "noopener");
    else showToast("لا يوجد تقرير طبي مرفوع لهذا الطلب.", true);
  });

  $("#translateReportBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري تشغيل OCR وترجمة التقرير...", async () => {
    try {
      const result = await api("translateMedicalReport", { session: SESSION, requestId: r.requestId });
      const en = document.getElementById("extractedEnglishText");
      const ar = document.getElementById("arabicTranslationText");
      const st = document.getElementById("translationStatusText");
      if (en) en.value = result.extractedText || "";
      if (ar) ar.value = result.translation || "";
      if (st) st.textContent = result.status || "تمت الترجمة آليًا";
      showToast("تم استخراج وترجمة التقرير. راجع النص ثم احفظ أو اعتمد الترجمة.");
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $("#saveTranslationBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري حفظ الترجمة...", async () => {
    try {
      const result = await api("saveTranslation", {
        session: SESSION,
        requestId: r.requestId,
        extractedText: document.getElementById("extractedEnglishText")?.value || "",
        translation: document.getElementById("arabicTranslationText")?.value || "",
        approved: false
      });
      const st = document.getElementById("translationStatusText");
      if (st) st.textContent = result.status || "محفوظة للمراجعة";
      showToast("تم حفظ الترجمة.");
    } catch (err) {
      showToast(err.message, true);
    }
  }));

  $("#approveTranslationBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري اعتماد الترجمة...", async () => {
    try {
      const result = await api("saveTranslation", {
        session: SESSION,
        requestId: r.requestId,
        extractedText: document.getElementById("extractedEnglishText")?.value || "",
        translation: document.getElementById("arabicTranslationText")?.value || "",
        approved: true
      });
      const st = document.getElementById("translationStatusText");
      if (st) st.textContent = result.status || "تم اعتماد الترجمة";
      showToast("تم اعتماد الترجمة وإضافتها إلى ملف المعاملة عند تجهيز البريد.");
    } catch (err) {
      showToast(err.message, true);
    }
  }));


  $("#emlBtn")?.addEventListener("click", (e) => {
    return withButtonLoading(e.currentTarget, "جاري تجهيز البريد...", async () => {
      try {
        const result = await api("generateOutlookEml", {
          session: SESSION,
          requestId: r.requestId,
          cc: $("#ccEmails")?.value || ""
        });
        const pdfLink = result.pdfDownloadUrl || result.pdfUrl;
        if (pdfLink && !result._downloadedOnce) {
          result._downloadedOnce = true;
          forceDownload(pdfLink, result.pdfFileName || "ملف_المعاملة.pdf");
        }
        await copyPreparedText(result.body || "");
        showMailPreparationPanel(result);
        showToast("تم تجهيز البريد الرسمي: تم تحميل PDF ونسخ نص الرسالة دون فتح صفحة جديدة.");
      } catch (err) {
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
    <p class="mail-note">تم تجهيز ملف PDF للمعاملة كاملة ونسخ نص الرسالة. افتح بريد الوزارة يدويًا، أنشئ رسالة جديدة، ثم انسخ بريد المدرسة والموضوع والصق نص الرسالة وأرفق ملف PDF الذي تم تحميله.</p>
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
      <button class="submit-btn" type="button" id="downloadPreparedPdf">تحميل PDF مرة أخرى</button>
      <button class="submit-btn" type="button" id="openWebmailBtn">فتح صفحة الإيميل</button>
      <button class="submit-btn" type="button" id="confirmEmailSentBtn">تأكيد إرسال البريد</button>
    </div>
  `;
  box.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const el = document.getElementById(btn.dataset.copy);
      const ok = await copyPreparedText(el?.value || el?.textContent || "");
      showToast(ok ? "تم النسخ." : "لم يتم النسخ تلقائيًا، انسخ النص يدويًا.", !ok);
    });
  });
  box.querySelector("#downloadPreparedPdf")?.addEventListener("click", () => {
    const pdfLink = result.pdfDownloadUrl || result.pdfUrl;
    if (pdfLink) forceDownload(pdfLink, result.pdfFileName || "ملف_المعاملة.pdf");
  });
  box.querySelector("#openWebmailBtn")?.addEventListener("click", () => {
    window.open(result.webmailUrl || CONFIG.WEBMAIL_URL, "_blank", "noopener");
  });
  box.querySelector("#confirmEmailSentBtn")?.addEventListener("click", (e) => withButtonLoading(e.currentTarget, "جاري تأكيد الإرسال...", async () => {
    try {
      const result2 = await api("confirmEmailSent", { session: SESSION, requestId: result.requestId });
      showToast(result2.message || "تم تأكيد إبلاغ المدرسة بالبريد.");
      const emailBoxes = document.querySelectorAll(".email-status-pill");
      emailBoxes.forEach(el => { el.className = "email-status-pill sent"; el.textContent = "تم إبلاغ المدرسة بالبريد"; });
      loadDashboard({ useCache: false, background: true });
    } catch (err) {
      showToast(err.message, true);
    }
  }));
}

function linkOrDash(url) {
  if (!url) return "—";
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">فتح الملف</a>`;
}

function escapeHtml(value) {
  return toLatinDigits(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }


function forceDownload(url, filename) {
  if (!url) return;
  try {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // احتياط: بعض روابط Google Drive تتجاهل download؛ نستخدم iframe مخفي حتى لا تُفتح صفحة جديدة.
    setTimeout(() => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 8000);
    }, 300);
  } catch (e) {
    showToast("تعذر بدء التحميل تلقائيًا. استخدم زر تحميل PDF مرة أخرى.", true);
  }
}

