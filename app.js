/* منصة معالجة أعذار الغياب عن الاختبارات
   واجهة GitHub Pages - الربط مع Google Apps Script
   غيّر قيمة API_URL بعد نشر Web App في Google Apps Script.
*/
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbw_n5sBb6x7dXeaJBXuc8m9_5w0wpQphvVwj_JtzJTvLVF9YzG96118egz1zbBqb2WV/exec",
};

let SESSION = null;
let CURRENT_REQUESTS = [];

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

function showSection(sectionId) {
  ["publicHome", "requestForm", "trackForm", "loginPanel", "dashboard"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });
  document.getElementById(sectionId).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goHome() {
  SESSION = null;
  showSection("publicHome");
}

async function api(action, payload = {}) {
  if (!CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_")) {
    throw new Error("لم يتم ضبط رابط Google Apps Script في ملف app.js.");
  }

  const response = await fetch(CONFIG.API_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload }),
  });

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
        data: result.includes(",") ? result.split(",")[1] : result,
      });
    };
    reader.readAsDataURL(file);
  });
}

async function collectFiles(input) {
  const files = Array.from(input?.files || []);
  const maxFiles = 5;
  const maxBytes = 10 * 1024 * 1024;
  if (files.length > maxFiles) throw new Error(`الحد الأقصى للمرفقات هو ${maxFiles} ملفات.`);
  for (const f of files) {
    if (f.size > maxBytes) throw new Error(`حجم الملف ${f.name} أكبر من 10 ميجابايت.`);
  }
  return Promise.all(files.map(fileToBase64));
}


function collectSubjectDates(form) {
  const rows = Array.from(form.querySelectorAll(".subject-date-row"));
  const pairs = [];
  rows.forEach((row, idx) => {
    const subject = row.querySelector("[data-subject]")?.value.trim() || "";
    const date = row.querySelector("[data-exam-date]")?.value || "";
    if (subject || date) {
      if (!subject || !date) throw new Error(`يرجى تعبئة المادة وتاريخ الاختبار في الصف رقم ${idx + 1}.`);
      pairs.push({ subject, date });
    }
  });
  if (!pairs.length) throw new Error("يرجى إضافة مادة واحدة على الأقل مع تاريخ الاختبار.");
  return {
    pairs,
    subjects: pairs.map(x => x.subject).join(" | "),
    examDate: pairs.map(x => `${x.subject}: ${x.date}`).join(" | "),
  };
}

function resetSubjectRows() {
  const holder = $("#subjectDateRows");
  if (!holder) return;
  holder.innerHTML = `
    <div class="subject-date-row">
      <label>المادة/المواد<input data-subject required placeholder="مثال: الرياضيات" /></label>
      <label>تاريخ الاختبار<input data-exam-date type="date" required /></label>
      <button class="small-btn remove-subject-row" type="button" disabled>حذف</button>
    </div>
  `;
}

function addSubjectRow() {
  const holder = $("#subjectDateRows");
  if (!holder) return;
  const row = document.createElement("div");
  row.className = "subject-date-row";
  row.innerHTML = `
    <label>المادة/المواد<input data-subject required placeholder="مثال: العلوم" /></label>
    <label>تاريخ الاختبار<input data-exam-date type="date" required /></label>
    <button class="small-btn remove-subject-row" type="button">حذف</button>
  `;
  holder.appendChild(row);
}

document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) showSection(open.dataset.open);

  const login = e.target.closest("[data-login]");
  if (login) {
    $("#loginTitle").textContent = login.dataset.login === "admin" ? "دخول إدارة تقويم الأداء المعرفي والمهاري" : "دخول المدرسة";
    $("#loginForm [name=role]").value = login.dataset.login;
    showSection("loginPanel");
  }

  if (e.target.closest("[data-back-home]")) showSection("publicHome");

  if (e.target.closest("#addSubjectRow")) addSubjectRow();

  const removeSubject = e.target.closest(".remove-subject-row");
  if (removeSubject && !removeSubject.disabled) {
    removeSubject.closest(".subject-date-row")?.remove();
  }
});

$("#newRequestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = e.submitter || form.querySelector("button[type=submit]");
  const originalText = btn?.textContent || "إرسال الطلب";
  if (btn) {
    btn.disabled = true;
    btn.classList.add("loading");
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>جاري إرسال الطلب...</span>`;
  }
  try {
    const request = formToObject(form);
    const subjectData = collectSubjectDates(form);
    request.subjects = subjectData.subjects;
    request.examDate = subjectData.examDate;
    request.subjectDatesJson = JSON.stringify(subjectData.pairs);

    if (!/^\d{10}$/.test(String(request.nationalId || ""))) throw new Error("رقم الهوية يجب أن يتكون من 10 أرقام فقط.");
    if (!/^05\d{8}$/.test(String(request.mobile || ""))) throw new Error("رقم الجوال يجب أن يتكون من 10 أرقام ويبدأ بـ 05.");

    const attachments = await collectFiles(form.elements.attachments);
    const result = await api("submitRequest", { request, attachments });
    showToast(`تم تقديم الطلب بنجاح. رقم الطلب: ${result.requestId}`);
    form.reset();
    resetSubjectRows();
    showSection("trackForm");
    $("#trackRequestForm [name=requestId]").value = result.requestId;
    $("#trackResult").innerHTML = `<b>رقم الطلب:</b> ${result.requestId}<br><span>احتفظ برقم الطلب لمتابعة الحالة.</span>`;
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.textContent = originalText;
    }
  }
});

$("#trackRequestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
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

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = formToObject(e.currentTarget);
    const result = await api("login", payload);
    SESSION = result.session;
    $("#roleLabel").textContent = SESSION.role === "admin" ? "إدارة تقويم الأداء المعرفي والمهاري" : `مدرسة: ${SESSION.orgName || ""}`;
    showSection("dashboard");
    await loadDashboard();
  } catch (err) {
    showToast(err.message, true);
  }
});

$("#logoutBtn").addEventListener("click", goHome);
$("#refreshBtn").addEventListener("click", loadDashboard);

async function loadDashboard() {
  try {
    const result = await api("listRequests", { session: SESSION });
    CURRENT_REQUESTS = result.requests || [];
    renderKpis(result.kpis || {});
    renderRequests(CURRENT_REQUESTS);
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

  $$("[data-view]").forEach(btn => btn.addEventListener("click", () => openDetails(btn.dataset.view)));
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
      <button class="submit-btn" id="approveBtn">اعتماد القرار</button>
      <button class="ghost-btn" id="pdfBtn">توليد PDF</button>
      <button class="ghost-btn" id="emlBtn">تجهيز بريد Outlook EML</button>
    </div>
  ` : "";

  details.innerHTML = `
    <div class="panel-head">
      <h2>تفاصيل الطلب: ${escapeHtml(r.requestId)}</h2>
      <button class="ghost-btn" onclick="document.getElementById('requestDetails').classList.add('hidden')">إغلاق</button>
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

  $("#approveBtn")?.addEventListener("click", async () => {
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
  });

  $("#pdfBtn")?.addEventListener("click", async () => {
    try {
      const result = await api("generatePdf", { session: SESSION, requestId: r.requestId });
      showToast("تم توليد ملف PDF.");
      if (result.pdfUrl) window.open(result.pdfUrl, "_blank");
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $("#emlBtn")?.addEventListener("click", async () => {
    try {
      const result = await api("generateOutlookEml", {
        session: SESSION,
        requestId: r.requestId,
        cc: $("#ccEmails")?.value || ""
      });
      showToast("تم تجهيز ملف Outlook EML.");
      if (result.emlUrl) window.open(result.emlUrl, "_blank");
    } catch (err) {
      showToast(err.message, true);
    }
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
