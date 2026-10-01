/* ============================================================
     EXCEL REPORT — month/all-month selection happens here in the
     admin. We keep generation local in this file so the exported
     workbook layout stays consistent with the cover-page version
     that admins already liked, and month-selection bugs are easier
     to fix without depending on a separate bundle.
     ============================================================ */
  const REPORT_MONTHS = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];
  let yearlyReportBundleLoaded = false;

  function loadYearlyReportBundle(){
    if (yearlyReportBundleLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'yearly-report-bundle.js';
      script.onload = () => { yearlyReportBundleLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Nu s-a putut încărca modulul de raport Excel.'));
      document.body.appendChild(script);
    });
  }

  // Same whitelist matching used server-side for the public site's
  // public_name column (see public-tickets-name-whitelist.sql) —
  // kept as a separate JS implementation here since this Excel
  // export runs entirely client-side against tickets already loaded
  // in memory, not a fresh database query. Diacritic mapping is
  // deliberately identical to the SQL version (handles both "ș/ț"
  // with comma-below and "ş/ţ" with cedilla), so a name matches or
  // doesn't the same way in both places.
  function normalizeRomanianText(value){
    return String(value || '')
      .toLowerCase()
      .replace(/[ăâ]/g, 'a')
      .replace(/î/g, 'i')
      .replace(/[șş]/g, 's')
      .replace(/[țţ]/g, 't');
  }
  function isWhitelistedReporterName(name){
    const normalized = normalizeRomanianText(name);
    if (normalized.includes('politia') && normalized.includes('locala')) return true;
    if (normalized.includes('birou') && normalized.includes('energetic')) return true;
    if (normalized.includes('autosesizare')) return true;
    return false;
  }

  function reportTicketType(ticket){
    return ticket.type === 'Anunt accident' ? 'Accident' : 'Defect';
  }

  function reportTicketStatus(ticket){
    return ticket.status === 'Terminat' ? 'Terminat' : 'Activ';
  }

  function reportDateValue(value){
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date;
  }

  function reportDateLabel(value){
    const date = reportDateValue(value);
    return date ? fmtDate(date) : '';
  }

  function reportHoursToResolve(tickets){
    const resolved = tickets.filter(ticket => ticket.submitted_on && ticket.resolved_on);
    if (resolved.length === 0) return 0;
    const totalHours = resolved.reduce((sum, ticket) => {
      return sum + ((parseTicketDate(ticket.resolved_on) - parseTicketDate(ticket.submitted_on)) / (1000 * 60 * 60));
    }, 0);
    return Math.round((totalHours / resolved.length) * 10) / 10;
  }

  function buildMonthlyStats(monthTickets, index){
    // Every count/average here excludes duplicates, same rationale as
    // everywhere else in the app — a duplicate isn't a separately
    // occurring issue, just a second report of one already counted.
    // `tickets` itself keeps every ticket including duplicates, since
    // the per-ticket table in makeMonthlyWorksheet lists them all
    // (marked via the "Duplicat" column) rather than hiding them.
    const nonDuplicateTickets = monthTickets.filter(ticket => !isDuplicateTicket(ticket));
    const active = nonDuplicateTickets.filter(ticket => reportTicketStatus(ticket) === 'Activ');
    const resolved = nonDuplicateTickets.filter(ticket => reportTicketStatus(ticket) === 'Terminat');
    const defects = nonDuplicateTickets.filter(ticket => reportTicketType(ticket) === 'Defect');
    const accidents = nonDuplicateTickets.filter(ticket => reportTicketType(ticket) === 'Accident');
    return {
      index,
      name: REPORT_MONTHS[index],
      tickets: monthTickets,
      total: nonDuplicateTickets.length,
      active: active.length,
      resolved: resolved.length,
      defects: defects.length,
      accidents: accidents.length,
      avgHours: reportHoursToResolve(nonDuplicateTickets),
    };
  }

  function autosizeWorksheet(ws, rows){
    const widths = [];
    rows.forEach(row => {
      row.forEach((value, index) => {
        const text = value == null ? '' : String(value);
        widths[index] = Math.max(widths[index] || 0, text.length);
      });
    });
    ws['!cols'] = widths.map(width => ({ wch: Math.min(Math.max(width + 2, 12), 40) }));
  }

  function makeMonthlyWorksheet(stats, year){
    const rows = [
      [`Sesizări ${stats.name} ${year}`],
      [],
      ['Indicator', 'Valoare'],
      ['Total sesizări', stats.total],
      ['Sesizări active', stats.active],
      ['Sesizări soluționate', stats.resolved],
      ['Defecte', stats.defects],
      ['Accidente', stats.accidents],
      ['Ore medii de soluționare', stats.avgHours],
      [],
      ['Nr. sesizare', 'Tip', 'Nume', 'Telefon', 'Email', 'Adresă', 'Descriere', 'Stare', 'Soluționat de', 'Ce s-a făcut', 'Trimis la', 'Soluționat la', 'Duplicat'],
    ];

    if (stats.tickets.length === 0) {
      rows.push(['Nu există sesizări în această lună.']);
    } else {
      stats.tickets.forEach(ticket => {
        const canonical = getCanonicalTicket(ticket);
        rows.push([
          ticket.ticket_number || '',
          reportTicketType(ticket),
          ticket.name || '',
          ticket.phone || '',
          ticket.email || '',
          ticket.address || '',
          ticket.description || '',
          reportTicketStatus(ticket),
          ticket.resolved_by || '',
          ticket.resolution_note || '',
          reportDateLabel(ticket.submitted_on),
          reportDateLabel(ticket.resolved_on),
          canonical ? `Duplicat al ${canonical.ticket_number || '—'}` : '',
        ]);
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!freeze'] = { xSplit: 0, ySplit: 11 };
    if (stats.tickets.length > 0) {
      ws['!autofilter'] = { ref: `A11:M${rows.length}` };
    }
    autosizeWorksheet(ws, rows);
    return ws;
  }

  function setSheetOpen(sheetId, open){
    const sheet = document.getElementById(sheetId);
    if (!sheet) return;
    sheet.classList.toggle('show', open);
    sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  document.querySelectorAll('[data-close-sheet]').forEach(btn => {
    btn.addEventListener('click', () => setSheetOpen(btn.dataset.closeSheet, false));
    // Backdrops specifically (not the × / "Aplică" buttons, which
    // are working fine as plain click targets) also get an explicit
    // touchstart handler with preventDefault() — a plain click
    // listener alone depends on the browser correctly synthesizing a
    // click from a tap, which isn't reliable enough on every real
    // phone to be the only path, even though it tests fine in
    // simulation (the sidebar's own backdrop had this exact same gap
    // between "works in a headless browser" and "works on an actual
    // phone" — see its own handler further down for the fuller
    // writeup of why).
    if (btn.classList.contains('mobile-sheet-backdrop')) {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        setSheetOpen(btn.dataset.closeSheet, false);
      }, { passive: false });
    }
  });

  function openReportTypeSelection(){
    const sheet = document.getElementById('reportTypeSheet');
    const fullBtn = document.getElementById('reportTypeFullBtn');
    const repairBtn = document.getElementById('reportTypeRepairBtn');
    const cancelBtn = document.getElementById('reportTypeCancelBtn');
    const closeBtn = document.getElementById('reportTypeCloseBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !fullBtn || !repairBtn || !cancelBtn || !closeBtn || !backdrop) {
      return Promise.resolve('full');
    }
    setSheetOpen('reportTypeSheet', true);
    return new Promise(resolve => {
      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('reportTypeSheet', false);
        fullBtn.removeEventListener('click', handleFull);
        repairBtn.removeEventListener('click', handleRepair);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };
      const handleFull = () => cleanup('full');
      const handleRepair = () => cleanup('repair');
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => { if (event.key === 'Escape') handleCancel(); };
      fullBtn.addEventListener('click', handleFull);
      repairBtn.addEventListener('click', handleRepair);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
    });
  }

  // Second step of the "Fișă remedieri" export — which active
  // tickets to include (all of them, only defecte, or only
  // accidente). Same open/resolve(null on cancel) pattern as
  // openReportTypeSelection just above.
  function openRepairScopeSelection(){
    const sheet = document.getElementById('repairScopeSheet');
    const allBtn = document.getElementById('repairScopeAllBtn');
    const funcBtn = document.getElementById('repairScopeFuncBtn');
    const accidentBtn = document.getElementById('repairScopeAccidentBtn');
    const cancelBtn = document.getElementById('repairScopeCancelBtn');
    const closeBtn = document.getElementById('repairScopeCloseBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !allBtn || !funcBtn || !accidentBtn || !cancelBtn || !closeBtn || !backdrop) {
      return Promise.resolve('all');
    }
    setSheetOpen('repairScopeSheet', true);
    return new Promise(resolve => {
      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('repairScopeSheet', false);
        allBtn.removeEventListener('click', handleAll);
        funcBtn.removeEventListener('click', handleFunc);
        accidentBtn.removeEventListener('click', handleAccident);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };
      const handleAll = () => cleanup('all');
      const handleFunc = () => cleanup('functional');
      const handleAccident = () => cleanup('accident');
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => { if (event.key === 'Escape') handleCancel(); };
      allBtn.addEventListener('click', handleAll);
      funcBtn.addEventListener('click', handleFunc);
      accidentBtn.addEventListener('click', handleAccident);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
    });
  }

  // Insta Grup's own logo, embedded as base64 so the generated file
  // doesn't depend on fetching a separate image asset — extracted
  // once from the real "Fișă remedierilor IP" template's own
  // embedded picture (xl/media/image1.png inside that .xlsx).
  const INSTA_GRUP_LOGO_BASE64 = 'data:image/png;base64,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';

  const FISA_HEADER_TITLE = 'Operațiuni efectuate pentru Mentenanța Sistemului de Iluminat Public în Municipiul Târgu Mureș';

  // Same column layout as the "Fișă remedieri IP" sheet the repair
  // import above knows how to read (see REPAIR_FIELD_GROUPS et al.
  // further down) — only Nr./Nr. Tichet/Strada si nr. are
  // filled in, every repair-step and Observatii column is left
  // blank for the field crew to mark by hand before it gets
  // re-uploaded. "Nr." is the source sheet's own plain row counter
  // (1, 2, 3...); "Nr. Tichet" is the actual ticket number — its
  // DATA cells only ever hold the bare number, but the header itself
  // keeps the full label. Text and column order copied verbatim
  // (including the source sheet's own lack of diacritics) from the
  // real FISA_REMEDIERILOR_IP.xlsx template — do not "correct" the
  // spelling here without re-checking that file, since this exact
  // wording is also what REPAIR_FIELD_GROUPS below matches against.
  const REPAIR_TEMPLATE_HEADERS_ROW2 = [
    'Nr.', 'Nr. Tichet', 'Strada si nr.', 'Scos/Repus sub tensiune', 'Verificat corp de iluminat',
    'Glob OLIMP', 'Corp iluminat', 'Capac stalp', 'Stalp', 'Burlan protectie',
    'SKD 578', 'Bec (W)', 'Driver (W)', 'Bobine (W)',
    'Refacute/Verificate', 'Sigurante schimbate', 'Cleme',
    'Contact slab refacut', 'Defrisari', 'Curatat corp iluminat',
    'Observatii',
  ];

  // The "Fișă remedieri" template needs real print formatting to be
  // usable on paper — A4 landscape, and the repair-step headers
  // rotated 90° so the narrow columns still fit across the page,
  // exactly like the source file staff already print and fill in by
  // hand. XLSX (SheetJS, used everywhere else in this file) is the
  // free/community build: it can only WRITE plain values, column
  // widths, row heights and merges — page orientation, images and
  // any cell styling (rotation, fonts, borders) are silently
  // dropped on write even if you set them, that's a Pro-only
  // feature there. ExcelJS writes all of that correctly, so it's
  // loaded from CDN on demand (only when this specific export is
  // used) rather than for every page load — same lazy-load pattern
  // as loadYearlyReportBundle() above, just a real npm package
  // instead of an in-repo bundle.
  let excelJsLoaded = false;
  function loadExcelJs(){
    if (excelJsLoaded || typeof ExcelJS !== 'undefined') { excelJsLoaded = true; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      script.onload = () => { excelJsLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Nu am putut încărca modulul necesar pentru fișa de remedieri.'));
      document.body.appendChild(script);
    });
  }

  // Logo + title banner across the top of a sheet, at a given row
  // (the multi-page fill-in form repeats this once per printed
  // page — see buildFisaSheet). The image floats over the first
  // columns at a fixed anchor (not tied to column width), while the
  // title text is a merged cell starting further right so the two
  // never overlap.
  function addFisaHeaderBanner(workbook, ws, colCount, logoImageId, rowNum){
    const bannerRow = ws.getRow(rowNum);
    bannerRow.height = 55;
    ws.addImage(logoImageId, { tl: { col: 0.15, row: rowNum - 1 + 0.1 }, ext: { width: 100, height: 66 } });
    const titleFromCol = Math.min(3, colCount);
    ws.mergeCells(rowNum, titleFromCol, rowNum, colCount);
    const titleCell = ws.getCell(rowNum, titleFromCol);
    titleCell.value = FISA_HEADER_TITLE;
    titleCell.font = { name: 'Calibri', size: 14, bold: true };
    // shrinkToFit (not wrapText) — auto-shrinks the font just enough
    // to keep the title on one line regardless of how wide the
    // merged area ends up being, instead of wrapping to a second
    // line the 55pt banner row isn't tall enough to show cleanly.
    titleCell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
  }

  // "Coperta" (cover page) — a quick-reference list of every active
  // ticket's phone number, street and problem description, printed
  // ahead of the fill-in form so the field crew has that context
  // without needing the admin panel open.
  function buildCoverSheet(workbook, orderedTickets, logoImageId){
    const headers = ['Nr. Tichet', 'Telefon', 'Stradă', 'Descriere problemă'];
    const ws = workbook.addWorksheet('Coperta', {
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0, footer: 0 },
      },
    });
    ws.columns = [{ width: 12 }, { width: 16 }, { width: 32 }, { width: 70 }];
    addFisaHeaderBanner(workbook, ws, headers.length, logoImageId, 1);

    const thin = { style: 'thin' };
    const allBorders = { top: thin, bottom: thin, left: thin, right: thin };
    const headerRow = ws.getRow(2);
    headers.forEach((label, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = label;
      cell.font = { name: 'Calibri', size: 12, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = allBorders;
    });

    // No fixed row height here either — Descriere problemă can run
    // long, and leaving the height unset lets Excel auto-grow each
    // row to fit the wrapped text instead of truncating it.
    orderedTickets.forEach((t, i) => {
      const row = ws.getRow(i + 3);
      row.getCell(1).value = extractTicketDigits(t.ticket_number) || t.ticket_number || '';
      row.getCell(2).value = t.phone || '';
      row.getCell(3).value = t.address || '';
      row.getCell(4).value = t.description || '';
      for (let col = 1; col <= headers.length; col++) {
        const cell = row.getCell(col);
        cell.font = { name: 'Calibri', size: 11 };
        cell.border = allBorders;
        cell.alignment = { vertical: 'top', horizontal: col === 1 ? 'center' : 'left', wrapText: col >= 3 };
      }
    });

    ws.pageSetup.printArea = `A1:D${orderedTickets.length + 2}`;
  }

  // Excel's own "fit to 1 page wide" (fitToWidth) doesn't pin down a
  // KNOWN scale percentage — it's computed by whatever's rendering
  // the file (Excel vs. LibreOffice vs. a print driver), each using
  // its own font-metrics estimate, and there's no way to read that
  // number back out to plan row heights against it. That mismatch
  // between the *assumed* scale and the *actual* one is what caused
  // both the leftover blank space at the bottom of the page and,
  // separately, an inconsistent extra page break mid-table — the
  // real available height was never what the row-count math assumed
  // it was. Fixed here by computing an EXPLICIT fixed scale
  // ourselves from the column widths below (same standard MDW=7px
  // Calibri-11 approximation Excel itself uses to turn a column
  // "width" into pixels), setting that directly instead of
  // fitToWidth, and sizing rows against the resulting KNOWN usable
  // area — every viewer then renders identically, and the row math
  // and the print math are finally computed from the same numbers.
  function excelColWidthToPoints(width){
    return (width * 7 + 5) * 0.75;
  }
  // Inverse of the above — how wide (in Excel's own column-width
  // units) a budget of points can afford, using the same MDW=7px
  // approximation. Used to figure out how much width is actually
  // left over for Observatii once every other column has claimed
  // what it needs.
  function pointsToExcelColWidth(points){
    return (points / 0.75 - 5) / 7;
  }
  // A4 landscape is 841.9pt × 595.3pt. Usable width/height below
  // already subtract this sheet's margins (0.3in+0.1in left/right,
  // 0.5in+0.5in top/bottom — header/footer margins are 0, since
  // this sheet's "header" and "footer" are ordinary in-sheet rows,
  // not Excel's print header/footer feature, so there's nothing to
  // reserve that space for).
  const FISA_USABLE_WIDTH_PT = 813;
  const FISA_USABLE_HEIGHT_PT = 523;
  // This is a fixed row-per-page count (each page a complete,
  // self-contained block with its own banner/group row/column
  // headers/footer, joined by a manual page break) rather than
  // relying on Excel's own automatic page break in the first place,
  // because a real automatic break just cuts the table wherever it
  // happens to land, with none of that repeated on the overflow
  // page. Unused rows on a page stay blank but pre-numbered, same as
  // the source sheet's own unused rows.

  // The actual fill-in form for the field crew — same column layout
  // the repair-sheet import above already knows how to read.
  function buildFisaSheet(workbook, orderedTickets, logoImageId){
    const headers = REPAIR_TEMPLATE_HEADERS_ROW2;
    const colCount = headers.length;
    const thin = { style: 'thin' };
    const allBorders = { top: thin, bottom: thin, left: thin, right: thin };
    const lastColLetter = String.fromCharCode(64 + colCount);

    // Column widths adapt to the real tickets being exported instead
    // of a guessed-in-advance fixed size — a short list with short
    // ticket numbers and addresses gets a tighter, more legible
    // table than one with many long ones. Checkbox columns hold at
    // most a single "x" mark regardless of the data, so there's
    // nothing to adapt there; they stay fixed and narrow. Observatii
    // holds nothing at all yet at export time (it's free-form notes,
    // filled in by hand after printing), so it can't be sized from
    // its own content either — it deliberately claims whatever width
    // is left over after every other column has taken what it
    // actually needs, since notes are exactly the column most likely
    // to run long and least acceptable to leave cramped.
    const CHECKBOX_COL_WIDTH = 4.5;
    const maxTicketDigits = orderedTickets.reduce((max, t) => Math.max(max, (extractTicketDigits(t.ticket_number) || '').length), 1);
    const maxAddressLen = orderedTickets.reduce((max, t) => Math.max(max, (t.address || '').length), 1);
    const nrWidth = Math.max(4, String(Math.max(orderedTickets.length, 1)).length + 2);
    const ticketWidth = Math.max(7, maxTicketDigits + 3);
    // Strada no longer needs to fit the longest possible address on
    // a single line — a row that wraps just grows its own height now
    // (see ticketRowHeight below) — so this aims for "most addresses
    // fit on one line without wrapping" rather than sizing for the
    // single longest outlier, which is what was eating into the
    // space Observatii could otherwise have.
    const stradaWidth = Math.min(38, Math.max(22, Math.round(maxAddressLen * 0.6) + 4));
    const fixedColsWidth = nrWidth + ticketWidth + stradaWidth + CHECKBOX_COL_WIDTH * (colCount - 4);
    const observatiiWidth = Math.max(stradaWidth + 6, Math.floor(pointsToExcelColWidth(FISA_USABLE_WIDTH_PT) - fixedColsWidth));

    const colWidths = headers.map((_, i) => {
      if (i === 0) return nrWidth;
      if (i === 1) return ticketWidth;
      if (i === 2) return stradaWidth;
      if (i === colCount - 1) return observatiiWidth;
      return CHECKBOX_COL_WIDTH;
    });
    const totalContentWidthPt = colWidths.reduce((sum, w) => sum + excelColWidthToPoints(w), 0);
    const printScale = Math.max(50, Math.min(100, Math.floor((FISA_USABLE_WIDTH_PT / totalContentWidthPt) * 100)));

    const ws = workbook.addWorksheet('Fisa remedieri', {
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: false,
        scale: printScale,
        margins: { left: 0.3, right: 0.1, top: 0.5, bottom: 0.5, header: 0, footer: 0 },
      },
    });
    ws.columns = colWidths.map(width => ({ width }));

    // Everything on the page (this sheet's content included) prints
    // at printScale%, so the page can actually hold
    // FISA_USABLE_HEIGHT_PT / (printScale/100) worth of NOMINAL
    // (unscaled) row height before the real, physical page edge is
    // reached. A 10% margin on top of that (0.9 factor) is the
    // actual safety buffer against this being slightly optimistic —
    // an underestimate here is what caused Excel to insert its own
    // unplanned extra page break mid-block before.
    const dataRowHeight = 19.7;
    const fixedOverheadPt = 55 /* banner */ + 18.75 /* group */ + 155 /* header */ + 15 /* spacer row */ + 26 /* footer */;
    const nominalHeightBudget = (FISA_USABLE_HEIGHT_PT / (printScale / 100)) * 0.9;
    const pageDataBudgetPt = nominalHeightBudget - fixedOverheadPt;

    // A street name that wraps to more than one line needs a taller
    // row than the single-line default, or the wrapped lines get
    // visually cut off at the row's own border — Excel/ExcelJS never
    // auto-grows row height for wrapped text, this has to be worked
    // out ourselves. colWidths[2] (Strada) is itself, by definition,
    // roughly how many characters of the sheet's normal font fit on
    // one line — 0.82 knocks a bit off for cell padding, erring
    // toward assuming FEWER characters fit per line (an
    // underestimate here just adds an unneeded extra line; an
    // overestimate is the actual cut-text bug).
    const streetCharsPerLine = Math.max(10, Math.floor(colWidths[2] * 0.82));
    const wrappedLineHeightPt = 14;
    const rowPaddingPt = 6;
    function ticketRowHeight(t){
      const len = t && t.address ? String(t.address).length : 0;
      const lineCount = Math.max(1, Math.ceil(len / streetCharsPerLine));
      return Math.max(dataRowHeight, lineCount * wrappedLineHeightPt + rowPaddingPt);
    }

    // Pages are packed by actual accumulated row height instead of a
    // fixed ticket count per page — a page with several long street
    // names genuinely holds fewer tickets than one where every
    // address is short and single-line. (i > start) in the inner
    // break condition guarantees a page always gets at least one
    // ticket even if that one ticket's own height alone exceeds the
    // budget, so a single pathological address can't loop forever or
    // silently vanish — it just prints slightly taller than the
    // nominal page budget, same tradeoff FISA_ROWS_PER_PAGE's old
    // fixed-count version had no way to avoid either.
    const fisaPages = [];
    {
      let i = 0;
      while (i < orderedTickets.length) {
        const start = i;
        let used = 0;
        while (i < orderedTickets.length) {
          const h = ticketRowHeight(orderedTickets[i]);
          if (used + h > pageDataBudgetPt && i > start) break;
          used += h;
          i++;
        }
        fisaPages.push({ start, count: i - start, usedHeight: used });
      }
      if (fisaPages.length === 0) fisaPages.push({ start: 0, count: 0, usedHeight: 0 });
    }

    let lastRowUsed = 0;
    let rowNumberCounter = 0;

    for (let page = 0; page < fisaPages.length; page++) {
      const { start, count, usedHeight } = fisaPages[page];
      const bannerRowNum = lastRowUsed + 1;
      addFisaHeaderBanner(workbook, ws, colCount, logoImageId, bannerRowNum);

      // Group labels (Demontat/Montat, Inlocuit, Legaturi, Diverse),
      // merged across the columns they cover, same layout and text
      // as the real source sheet. The leading columns (Nr./Nr.
      // Tichet/Strada/the two Verificări columns) and the trailing
      // Observatii column aren't part of any group on the source
      // sheet either — filled in here as blank, bordered cells (not
      // left untouched) so the top border row reads as one
      // continuous line across the full table width instead of
      // having a gap over those columns. Border is applied to every
      // column in each merged range, not just its anchor cell — for
      // a merge, Excel only draws the outer perimeter regardless,
      // but the anchor cell alone won't produce a full box around it
      // when printed.
      const groupRowNum = bannerRowNum + 1;
      const groupRow = ws.getRow(groupRowNum);
      groupRow.height = 18.75;
      [
        { label: '', from: 1, to: 5 },
        { label: 'Demontat/Montat', from: 6, to: 10 },
        { label: 'Inlocuit', from: 11, to: 14 },
        { label: 'Legaturi', from: 15, to: 17 },
        { label: 'Diverse', from: 18, to: 20 },
        { label: '', from: colCount, to: colCount },
      ].forEach(g => {
        if (g.from !== g.to) ws.mergeCells(groupRowNum, g.from, groupRowNum, g.to);
        for (let col = g.from; col <= g.to; col++) {
          ws.getCell(groupRowNum, col).border = allBorders;
        }
        const cell = ws.getCell(groupRowNum, g.from);
        cell.value = g.label;
        cell.font = { name: 'Calibri', size: 14 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // The real column headers. Every repair-step label gets
      // rotated 90° so it stays readable in a ~4-char-wide column;
      // Strada si nr. and Observatii stay horizontal since they hold
      // free text, not a one-word checkbox label.
      const headerRowNum = groupRowNum + 1;
      const headerRow = ws.getRow(headerRowNum);
      headerRow.height = 155;
      headers.forEach((label, i) => {
        const col = i + 1;
        const cell = headerRow.getCell(col);
        cell.value = label;
        const rotated = col !== 3 && col !== colCount;
        cell.alignment = rotated
          ? { textRotation: 90, horizontal: 'center', vertical: 'bottom', wrapText: true }
          : { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.font = { name: 'Calibri', size: 12 };
        cell.border = allBorders;
      });

      // Real tickets first, each at its own computed height; then
      // pad the rest of this page's budget with blank, pre-numbered
      // rows at the base single-line height — Nr. keeps counting
      // even past the real tickets, so unused rows stay pre-numbered
      // and ready to fill in by hand, same as the source sheet, just
      // however many now fit the remaining real points instead of a
      // fixed count.
      const firstDataRow = headerRowNum + 1;
      let rowOffset = 0;
      const styleDataCell = (row) => {
        for (let col = 1; col <= colCount; col++) {
          const cell = row.getCell(col);
          cell.font = { name: 'Calibri', size: 11 };
          cell.border = allBorders;
          cell.alignment = {
            vertical: 'middle',
            horizontal: col === 3 ? 'left' : 'center',
            wrapText: col === 3,
          };
        }
      };
      for (let r = 0; r < count; r++) {
        const t = orderedTickets[start + r];
        const row = ws.getRow(firstDataRow + rowOffset);
        row.height = ticketRowHeight(t);
        rowNumberCounter++;
        row.getCell(1).value = rowNumberCounter;
        row.getCell(2).value = extractTicketDigits(t.ticket_number) || t.ticket_number || '';
        row.getCell(3).value = t.address || '';
        styleDataCell(row);
        rowOffset++;
      }
      let remainingBudget = pageDataBudgetPt - usedHeight;
      while (remainingBudget >= dataRowHeight) {
        const row = ws.getRow(firstDataRow + rowOffset);
        row.height = dataRowHeight;
        rowNumberCounter++;
        row.getCell(1).value = rowNumberCounter;
        styleDataCell(row);
        rowOffset++;
        remainingBudget -= dataRowHeight;
      }
      const lastDataRow = firstDataRow + rowOffset - 1;

      // Footer — a signature line for whoever filled the sheet in,
      // one blank row below the data so it doesn't read as part of
      // the table itself.
      const footerRowNum = lastDataRow + 2;
      const footerRow = ws.getRow(footerRowNum);
      footerRow.height = 26;
      const third = Math.ceil(colCount / 3);
      [
        { text: 'Nume: ' + '_'.repeat(28), from: 1, to: third },
        { text: 'Semnătură: ' + '_'.repeat(28), from: third + 1, to: third * 2 },
        { text: 'Data: ' + '_'.repeat(20), from: third * 2 + 1, to: colCount },
      ].forEach(f => {
        ws.mergeCells(footerRowNum, f.from, footerRowNum, f.to);
        const cell = ws.getCell(footerRowNum, f.from);
        cell.value = f.text;
        cell.font = { name: 'Calibri', size: 12 };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      });

      if (page < fisaPages.length - 1) {
        // Forces everything after this row onto a new printed page,
        // rather than letting Excel decide where to break — see
        // fisaPages above for why.
        ws.getRow(footerRowNum).addPageBreak();
        lastRowUsed = footerRowNum + 1; // blank row before the next page's banner
      } else {
        lastRowUsed = footerRowNum;
      }
    }

    ws.pageSetup.printArea = `A1:${lastColLetter}${lastRowUsed}`;
  }

  async function buildRepairTemplateWorkbookBuffer(activeTickets){
    const ordered = sortTicketsByNumber(activeTickets);
    const workbook = new ExcelJS.Workbook();
    // Registered once and reused on both sheets — otherwise each
    // addFisaHeaderBanner call would embed its own full copy of the
    // logo, doubling the file's size for no reason.
    const logoImageId = workbook.addImage({ base64: INSTA_GRUP_LOGO_BASE64, extension: 'png' });
    buildCoverSheet(workbook, ordered, logoImageId);
    buildFisaSheet(workbook, ordered, logoImageId);
    return workbook.xlsx.writeBuffer();
  }

  const REPAIR_SCOPE_LABELS = {
    all: 'sesizări active',
    functional: 'defecte active',
    accident: 'accidente active',
  };
  async function exportRepairTemplate(btn, scope){
    // Icon-only button now (see the toolbar cleanup) — disabling it
    // is feedback enough (.btn:disabled dims it) without swapping
    // its content for loading text and permanently losing the icon
    // afterwards, since btn.textContent on an <svg>-only button
    // reads back as ''.
    btn.disabled = true;
    try {
      // Genuinely active/unresolved tickets only — this is the
      // work-list handed to the field crew for issues nobody's fixed
      // yet, deliberately separate from tickets sesizari@ already
      // closed and that are just waiting on vlasbogdan@'s paperwork
      // (those show up under "Așteaptă raport" instead, not here).
      // The repair-sheet *import* matching further down searches
      // both sets, since an uploaded sheet can cover either kind —
      // only this download is scoped to active-only. Further narrowed
      // to just defecte or just accidente when that's what was picked
      // in openRepairScopeSelection. A duplicate ticket is excluded —
      // it's the same physical job as its canonical original, already
      // listed under that original's own ticket number, so including
      // it too would send the field crew out to fix the same thing
      // twice under two different numbers.
      const activeTickets = allTickets.filter(t => t.status !== 'Terminat' && !t.archived
        && !isDuplicateTicket(t)
        && (scope === 'functional' ? t.type !== 'Anunt accident'
          : scope === 'accident' ? t.type === 'Anunt accident'
          : true));
      const scopeLabel = REPAIR_SCOPE_LABELS[scope] || REPAIR_SCOPE_LABELS.all;
      if (activeTickets.length === 0) {
        alert(`Nu există ${scopeLabel} în acest moment.`);
        return;
      }
      await loadExcelJs();
      const buffer = await buildRepairTemplateWorkbookBuffer(activeTickets);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      const scopeSuffix = scope === 'functional' ? '-defecte' : scope === 'accident' ? '-accidente' : '';
      a.download = `fisa-remedieri-active${scopeSuffix}-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Fișa de remedieri a fost descărcată (${activeTickets.length} ${scopeLabel}).`);
    } catch (err) {
      console.error('Repair template export failed:', err);
      alert('Eroare la generarea fișei: ' + (err && err.message ? err.message : 'motiv necunoscut'));
    } finally {
      btn.disabled = false;
    }
  }

  /* Runs before openReportMonthSelection whenever "Toate anii" is
     selected in the main year filter — the yearly report is
     inherently a single-year document (its cover sheet is titled
     "Raport anual sesizări {year}"), so silently picking the current
     year when the person is looking at every year would export data
     that doesn't match what's on screen. Forces an explicit choice
     among the years that actually have tickets instead. */
  function openReportYearSelection(years){
    const sheet = document.getElementById('reportYearSheet');
    const list = document.getElementById('reportYearList');
    const confirmBtn = document.getElementById('reportYearConfirmBtn');
    const cancelBtn = document.getElementById('reportYearCancelBtn');
    const closeBtn = document.getElementById('reportYearCloseBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !list || !confirmBtn || !cancelBtn || !closeBtn || !backdrop || !years.length) {
      return Promise.resolve(years[0] ? String(years[0]) : null);
    }

    list.innerHTML = years.map((y, index) => `
      <label class="month-picker-option">
        <input type="radio" name="reportYearChoice" value="${y}" ${index === 0 ? 'checked' : ''}>
        <span>${y}</span>
      </label>
    `).join('');
    setSheetOpen('reportYearSheet', true);

    return new Promise(resolve => {
      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('reportYearSheet', false);
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };
      const handleConfirm = () => {
        const picked = list.querySelector('input[name="reportYearChoice"]:checked');
        cleanup(picked ? picked.value : null);
      };
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => { if (event.key === 'Escape') handleCancel(); };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
    });
  }

  function openReportMonthSelection(year){
    const sheet = document.getElementById('reportMonthSheet');
    const lead = document.getElementById('reportMonthSheetLead');
    const list = document.getElementById('reportMonthList');
    const allToggle = document.getElementById('reportMonthAllToggle');
    const confirmBtn = document.getElementById('reportMonthConfirmBtn');
    const cancelBtn = document.getElementById('reportMonthCancelBtn');
    const closeBtn = document.getElementById('reportMonthCloseBtn');
    const backdrop = sheet ? sheet.querySelector('.mobile-sheet-backdrop') : null;
    if (!sheet || !lead || !list || !allToggle || !confirmBtn || !cancelBtn || !closeBtn || !backdrop) {
      return Promise.resolve('all');
    }

    lead.textContent = `Alege luna sau lunile pentru raportul ${year}.`;
    list.innerHTML = REPORT_MONTHS.map((month, index) => `
      <label class="month-picker-option">
        <input type="checkbox" value="${index}" class="report-month-checkbox">
        <span>${month}</span>
      </label>
    `).join('');
    allToggle.checked = true;
    list.querySelectorAll('.report-month-checkbox').forEach(box => { box.disabled = true; box.checked = false; });
    setSheetOpen('reportMonthSheet', true);

    return new Promise(resolve => {
      let settled = false;
      const boxes = () => Array.from(list.querySelectorAll('.report-month-checkbox'));

      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setSheetOpen('reportMonthSheet', false);
        allToggle.removeEventListener('change', handleAllToggle);
        boxes().forEach(box => box.removeEventListener('change', handleBoxChange));
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleKeydown);
        resolve(result);
      };

      const handleAllToggle = () => {
        boxes().forEach(box => {
          box.disabled = allToggle.checked;
          if (allToggle.checked) box.checked = false;
        });
      };
      const handleBoxChange = () => {
        if (boxes().some(box => box.checked)) allToggle.checked = false;
      };
      const handleConfirm = () => {
        if (allToggle.checked) {
          cleanup('all');
          return;
        }
        const selected = boxes()
          .filter(box => box.checked)
          .map(box => Number(box.value))
          .sort((a, b) => a - b);
        if (!selected.length) {
          alert('Alegeți cel puțin o lună sau bifați "Toate lunile".');
          return;
        }
        cleanup(selected);
      };
      const handleCancel = () => cleanup(null);
      const handleKeydown = (event) => {
        if (event.key === 'Escape') handleCancel();
      };

      allToggle.addEventListener('change', handleAllToggle);
      boxes().forEach(box => box.addEventListener('change', handleBoxChange));
      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      backdrop.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleKeydown);
    });
  }

  function buildYearlyWorkbookBinary(yearTickets, year, monthSelection){
    const workbook = XLSX.utils.book_new();
    const monthlyBuckets = Array.from({ length: 12 }, () => []);

    yearTickets
      .filter(ticket => ticket.submitted_on)
      .sort((a, b) => parseTicketDate(a.submitted_on) - parseTicketDate(b.submitted_on))
      .forEach(ticket => {
        const submitted = parseTicketDate(ticket.submitted_on);
        if (!Number.isNaN(submitted.getTime())) {
          monthlyBuckets[submitted.getMonth()].push(ticket);
        }
      });

    const monthlyStats = monthlyBuckets.map((tickets, index) => buildMonthlyStats(tickets, index));
    const selectedMonths = monthSelection === 'all'
      ? monthlyStats
      : monthlyStats.filter(month => monthSelection.includes(month.index));
    // Every ticket in scope, including duplicates — the per-month
    // sheets below list all of them (marked via their own "Duplicat"
    // column). Every count/average on this cover page, though, is
    // computed from statsTickets (duplicates excluded) so a duplicate
    // is never counted twice toward the same underlying issue.
    const allSelectedTickets = selectedMonths.flatMap(month => month.tickets);
    const statsTickets = allSelectedTickets.filter(ticket => !isDuplicateTicket(ticket));
    const scopeLabel = monthSelection === 'all'
      ? `toate lunile din ${year}`
      : selectedMonths.map(month => month.name).join(', ') + ` ${year}`;
    const activeCount = statsTickets.filter(ticket => reportTicketStatus(ticket) === 'Activ').length;
    const resolvedCount = statsTickets.filter(ticket => reportTicketStatus(ticket) === 'Terminat').length;
    const defectCount = statsTickets.filter(ticket => reportTicketType(ticket) === 'Defect').length;
    const accidentCount = statsTickets.filter(ticket => reportTicketType(ticket) === 'Accident').length;
    const avgHours = reportHoursToResolve(statsTickets);
    const busiestMonth = selectedMonths.reduce((best, current) => current.total > best.total ? current : best, selectedMonths[0]);
    const slowestMonth = selectedMonths.reduce((best, current) => current.avgHours > best.avgHours ? current : best, selectedMonths[0]);

    const coverRows = [
      [monthSelection === 'all' ? `Raport anual sesizări ${year}` : `Raport sesizări ${scopeLabel}`],
      ['Generat automat din panoul admin Insta Grup'],
      [],
      ['Indicator', 'Valoare'],
      ['Perioadă', scopeLabel],
      ['Total sesizări', statsTickets.length],
      ['Sesizări active', activeCount],
      ['Sesizări soluționate', resolvedCount],
      ['Defecte', defectCount],
      ['Accidente', accidentCount],
      ['Ore medii de soluționare', avgHours],
      ['Luna cu cele mai multe sesizări', `${busiestMonth.name} (${busiestMonth.total})`],
      ['Luna cu timpul mediu cel mai mare', `${slowestMonth.name} (${slowestMonth.avgHours} ore)`],
      [],
      ['Lună', 'Total', 'Active', 'Soluționate', 'Defecte', 'Accidente', 'Ore medii'],
    ];

    selectedMonths.forEach(month => {
      coverRows.push([
        month.name,
        month.total,
        month.active,
        month.resolved,
        month.defects,
        month.accidents,
        month.avgHours,
      ]);
    });

    // Sesizări de la instituții — tickets whose reporter name matches
    // the whitelist (Poliția locală / Biroul energetic / Autosesizare).
    // Only these three specifically are ever named here; every other
    // ticket's real reporter name stays out of this export entirely,
    // matching the same restriction already enforced for the public
    // website (see public-tickets-name-whitelist.sql).
    const institutionalTickets = statsTickets.filter(ticket => isWhitelistedReporterName(ticket.name));
    coverRows.push([]);
    coverRows.push(['Sesizări de la instituții']);
    coverRows.push(['Nr. sesizare', 'Raportat de', 'Adresă', 'Data']);
    if (institutionalTickets.length === 0) {
      coverRows.push(['Nicio sesizare de la instituții în această perioadă.']);
    } else {
      institutionalTickets.forEach(ticket => {
        coverRows.push([
          ticket.ticket_number || '',
          ticket.name || '',
          ticket.address || '',
          reportDateLabel(ticket.submitted_on),
        ]);
      });
    }

    const coverSheet = XLSX.utils.aoa_to_sheet(coverRows);
    coverSheet['!freeze'] = { xSplit: 0, ySplit: 15 };
    autosizeWorksheet(coverSheet, coverRows);
    XLSX.utils.book_append_sheet(workbook, coverSheet, `Coperta ${year}`.slice(0, 31));

    selectedMonths.forEach(month => {
      const ws = makeMonthlyWorksheet(month, year);
      XLSX.utils.book_append_sheet(workbook, ws, `${month.name} ${year}`.slice(0, 31));
    });

    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  }

  async function handleExcelExport(triggerButton){
    const btn = triggerButton || document.getElementById('exportExcelBtn');
    if (!btn) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      const reportType = await openReportTypeSelection();
      if (reportType === null) return;
      if (reportType === 'repair') {
        const scope = await openRepairScopeSelection();
        if (scope === null) return;
        await exportRepairTemplate(btn, scope);
        return;
      }
      let year;
      if (ticketYearFilter === 'all') {
        const years = new Set();
        allTickets.forEach(t => {
          const { year: y } = getEffectiveMonthYear(t);
          if (y) years.add(y);
        });
        const sortedYears = [...years].sort((a, b) => b - a);
        const pickedYear = await openReportYearSelection(sortedYears);
        if (pickedYear === null) return;
        year = Number(pickedYear);
      } else {
        year = Number(ticketYearFilter);
      }
      btn.textContent = 'Se generează...';
      const monthSelection = await openReportMonthSelection(year);
      if (monthSelection === null) return;

      const yearTickets = allTickets.filter(t => {
        if (!t.submitted_on) return false;
        return parseTicketDate(t.submitted_on).getFullYear() === year;
      });
      if (yearTickets.length === 0) {
        alert(`Nu există sesizări pentru anul ${year}.`);
        return;
      }

      if (monthSelection !== 'all') {
        const selectedMonthSet = new Set(monthSelection);
        const hasTicketsInSelection = yearTickets.some(t => {
          const submitted = parseTicketDate(t.submitted_on);
          return !Number.isNaN(submitted.getTime()) && selectedMonthSet.has(submitted.getMonth());
        });
        if (!hasTicketsInSelection) {
          const selectedMonthNames = monthSelection.map(index => REPORT_MONTHS[index]).join(', ');
          alert(`Nu există sesizări pentru ${selectedMonthNames} ${year}.`);
          return;
        }
      }

      const exportTickets = monthSelection === 'all'
        ? yearTickets
        : yearTickets.filter(t => {
            const submitted = parseTicketDate(t.submitted_on);
            return !Number.isNaN(submitted.getTime()) && monthSelection.includes(submitted.getMonth());
          });

      const bytes = buildYearlyWorkbookBinary(yearTickets, year, monthSelection);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = monthSelection === 'all'
        ? `raport-sesizari-${year}.xlsx`
        : `raport-sesizari-${year}-${monthSelection.map(index => String(index + 1).padStart(2, '0')).join('-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Raportul pentru ${year} a fost descărcat.`);
    } catch (err) {
      console.error('Yearly Excel report failed:', err);
      alert('Eroare la generarea raportului Excel: ' + (err && err.message ? err.message : 'motiv necunoscut'));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  const exportExcelBtn = document.getElementById('exportExcelBtn');
  if (exportExcelBtn) exportExcelBtn.addEventListener('click', () => handleExcelExport(exportExcelBtn));

  /* ============================================================
     EXCEL EXPORT — same client-side XLSX mechanism as the "Raport
     Excel" button on Sesizări (build a sheet with XLSX.utils, get
     bytes via XLSX.write, wrap in a Blob, trigger via a throwaway
     <a download>). Single flat sheet rather than a year/month-split
     workbook, since backlog items aren't organized by submission
     month the way tickets are — exports whatever the current filter
     and search show, so what's on screen is what's in the file.
     ============================================================ */
  function exportBacklogToExcel(){
    const rows = getFilteredBacklogProjects();
    const header = ['Tipul lucrării', 'Adresă', 'Nume angajat', 'Data înregistrării', 'Descriere', 'Stare', 'Zile', 'Data soluționării'];
    const aoa = [header];
    rows.forEach(p => {
      const isDone = (p.status || 'Ongoing') === 'Terminat';
      const days = daysSince(p.start_date, isDone ? p.resolved_on : null);
      aoa.push([
        p.title || '',
        p.address || '',
        p.employee_name || '',
        p.start_date || '',
        p.description || '',
        isDone ? 'Soluționat' : 'Activ',
        days,
        isDone && p.resolved_on ? p.resolved_on.slice(0, 10) : '',
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, 'Avarii rețele'.slice(0, 31));
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `avarii-retele-${today}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Fișierul Excel a fost descărcat.');
  }
  const exportBacklogExcelBtn = document.getElementById('exportBacklogExcelBtn');
  if (exportBacklogExcelBtn) exportBacklogExcelBtn.addEventListener('click', exportBacklogToExcel);

  /* ============================================================
     EXCEL BULK IMPORT — parses an uploaded .xlsx/.xls/.csv client-side
     (SheetJS, no server involved) and shows a preview before writing
     anything to Supabase. Expected columns (first row = headers,
     order doesn't matter, matching is case/diacritic-insensitive):
       Tip lucrare | Adresă | Data început | Data finalizare
     Accepts a few header variants (Title/Adresa/Start/Due etc.) to
     be forgiving about exactly how the sheet was built.
     ============================================================ */
  const excelInput = document.getElementById('excelInput');
  document.getElementById('importExcelBtn').addEventListener('click', () => excelInput.click());

  function normalizeHeader(h){
    return String(h || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .trim();
  }
  const HEADER_MAP = {
    title: ['tip lucrare', 'titlu', 'title', 'lucrare', 'proiect'],
    address: ['adresa', 'address', 'locatie', 'location'],
    start: ['data inceput', 'inceput', 'start', 'start date', 'data start'],
    due: ['data finalizare', 'finalizare', 'due', 'due date', 'data sfarsit', 'sfarsit', 'termen'],
  };

  function excelDateToISO(value){
    if (value instanceof Date) {
      // Not toISOString(): xlsx builds this Date from the cell's local
      // Y/M/D (a date-only cell has no timezone of its own), so
      // converting to UTC first shifts the date back a day in any
      // zone ahead of UTC (e.g. Bucharest) -- read the same local
      // components back out instead.
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (typeof value === 'number') {
      // Excel serial date -> JS date
      const d = XLSX.SSF.parse_date_code(value);
      if (!d) return null;
      return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
    const str = String(value || '').trim();
    // try common formats: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return str;
    m = str.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return null;
  }

  let pendingImportRows = [];

  function isDuplicateProject(title, address, start, due){
    const norm = s => String(s || '').trim().toLowerCase();
    return allProjects.some(p =>
      norm(p.title) === norm(title) &&
      norm(p.address) === norm(address) &&
      p.start_date === start &&
      p.due_date === due
    );
  }

  excelInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(evt.target.result, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (rows.length < 2) {
          alert('Fișierul nu conține date (doar antet sau gol).');
          return;
        }
        const headers = rows[0].map(normalizeHeader);
        const colIndex = {};
        Object.keys(HEADER_MAP).forEach(key => {
          const idx = headers.findIndex(h => HEADER_MAP[key].includes(h));
          colIndex[key] = idx;
        });

        pendingImportRows = rows.slice(1)
          .filter(r => r.some(cell => String(cell).trim() !== ''))
          .map(r => {
            const title = colIndex.title >= 0 ? String(r[colIndex.title] || '').trim() : '';
            const address = colIndex.address >= 0 ? String(r[colIndex.address] || '').trim() : '';
            const start = colIndex.start >= 0 ? excelDateToISO(r[colIndex.start]) : null;
            const due = colIndex.due >= 0 ? excelDateToISO(r[colIndex.due]) : null;
            const valid = !!(title && address && start && due);
            // Re-uploading the same workbook (or one that overlaps an
            // earlier upload) would otherwise insert the same project
            // again with a fresh id -- flag an exact match against
            // what's already in the database so it can be excluded
            // from the import instead of silently duplicated.
            const duplicate = valid && isDuplicateProject(title, address, start, due);
            return { title, address, start, due, valid, duplicate };
          });

        renderExcelPreview();
      } catch (err) {
        console.error(err);
        alert('Nu am putut citi acest fișier. Verificați că este un .xlsx, .xls sau .csv valid.');
      }
      excelInput.value = '';
    };
    reader.readAsArrayBuffer(file);
  });

  function renderExcelPreview(){
    projectForm.style.display = 'none';
    const table = document.getElementById('excelPreviewTable');
    const importCount = pendingImportRows.filter(r => r.valid && !r.duplicate).length;
    const duplicateCount = pendingImportRows.filter(r => r.valid && r.duplicate).length;
    table.innerHTML = `
      <thead><tr>
        <th>Tip lucrare</th><th>Adresă</th><th>Început</th><th>Finalizare</th><th>Stare</th>
      </tr></thead>
      <tbody>
        ${pendingImportRows.map(r => `
          <tr class="${!r.valid ? 'row-error' : r.duplicate ? 'row-duplicate' : ''}">
            <td>${escapeHtml(r.title) || '—'}</td>
            <td>${escapeHtml(r.address) || '—'}</td>
            <td>${r.start || '—'}</td>
            <td>${r.due || '—'}</td>
            <td>${!r.valid ? '✗ incomplet / dată invalidă' : r.duplicate ? '↺ există deja, va fi ignorat' : '✓ OK'}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    document.querySelector('.excel-preview-note').textContent =
      `Previzualizare — ${importCount} din ${pendingImportRows.length} rânduri vor fi importate.` +
      (duplicateCount > 0 ? ` ${duplicateCount} există deja în listă și vor fi ignorate.` : '') +
      ` Rândurile marcate cu eroare vor fi ignorate.`;
    excelPreviewWrap.style.display = 'block';
    excelPreviewWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  document.getElementById('excelCancelBtn').addEventListener('click', () => {
    pendingImportRows = [];
    excelPreviewWrap.style.display = 'none';
  });

  document.getElementById('excelConfirmBtn').addEventListener('click', async () => {
    const validRows = pendingImportRows.filter(r => r.valid && !r.duplicate);
    if (validRows.length === 0) {
      alert('Niciun rând nou de importat.');
      return;
    }
    const payload = validRows.map(r => ({
      title: r.title, address: r.address, start_date: r.start, due_date: r.due,
    }));
    const { error } = await supabaseClient.from('current_projects').insert(payload);
    if (error) {
      console.error(error);
      alert('Eroare la import. Încercați din nou.');
      return;
    }
    pendingImportRows = [];
    excelPreviewWrap.style.display = 'none';
    loadProjects();
  });

  /* ============================================================
     REPAIR SHEET IMPORT ("Fișă remedieri IP") — ported 1:1 from
     admin.html (comments trimmed, same reasoning applies here — see
     that file for the full history). Lets vlasbogdan@ upload the
     field team's Excel repair sheet and auto-fill "Ce s-a făcut" for
     every ticket it lists, instead of typing each one in by hand.
     Deliberately only ever writes resolution_note — never touches
     status/resolved_by/resolved_on.
     ============================================================ */
  const REPAIR_FIELD_GROUPS = [
    { title: 'Verificări', fields: [
        { header: 'scos/repus sub tensiune', label: 'Scos/Repus sub tensiune' },
        { header: 'verificat corp de iluminat', label: 'Verificat corp de iluminat' },
      ]},
    { title: 'Demontat/Montat', fields: [
        { header: 'glob olimp', label: 'Glob OLIMP' },
        { header: 'corp iluminat', label: 'Corp iluminat' },
        { header: 'capac stalp', label: 'Capac stâlp' },
        { header: 'stalp', label: 'Stâlp' },
        { header: 'burlan protectie', label: 'Burlan protecție' },
      ]},
    { title: 'Inlocuit', fields: [
        { header: 'skd 578', label: 'SKD 578' },
        { header: 'bec (w)', label: 'Bec' },
        { header: 'driver (w)', label: 'Driver' },
        { header: 'bobine (w)', label: 'Bobine' },
      ]},
    { title: 'Legături', fields: [
        { header: 'refacute/verificate', label: 'Refăcute/Verificate' },
        { header: 'sigurante schimbate', label: 'Siguranțe schimbate' },
        { header: 'cleme', label: 'Cleme' },
      ]},
    { title: 'Diverse', fields: [
        { header: 'contact slab refacut', label: 'Contact slab refăcut' },
        { header: 'defrisari', label: 'Defrișări' },
        { header: 'curatat corp iluminat', label: 'Curățat corp iluminat' },
      ]},
  ];
  const REPAIR_TICKET_HEADERS = ['nr. tichet', 'nr tichet', 'numar tichet', 'nr tichet.', 'ticket'];
  const REPAIR_STREET_HEADERS = ['strada si nr.', 'strada si nr', 'strada', 'adresa'];
  const REPAIR_OBS_HEADERS = ['observatii', 'observatii.', 'obs'];
  // Columns that only ever exist on the real "Fisa remedieri" sheet.
  // The exported workbook always bundles a "Coperta" cover page ahead
  // of it, and Coperta ALSO has its own "Nr. Tichet" column (a quick
  // phone/street/description reference for the field crew) -- so
  // checking for a ticket-number column alone can't tell the two
  // sheets apart. Reading Coperta by mistake still "found" a valid
  // ticket-number column, matched real tickets by number/street, and
  // silently built an EMPTY repair note for every single one (Coperta
  // has none of these columns, or an Observații column, at all).
  const REPAIR_SPECIFIC_HEADERS = new Set([
    ...REPAIR_FIELD_GROUPS.flatMap(g => g.fields.map(f => f.header)),
    ...REPAIR_OBS_HEADERS,
  ]);

  let pendingRepairRows = [];
  let repairSkippedUnchangedCount = 0;

  function isRepairCellChecked(value){
    return String(value == null ? '' : value).trim() !== '';
  }

  function extractTicketDigits(value){
    const match = String(value == null ? '' : value).match(/\d+/);
    return match ? String(parseInt(match[0], 10)) : '';
  }

  const STREET_MATCH_STOPWORDS = new Set(['str', 'strada', 'nr', 'numarul', 'bd', 'bdul', 'aleea', 'sos', 'soseaua']);
  function streetWordSet(value){
    return new Set(
      normalizeRomanianText(value)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(w => w && !STREET_MATCH_STOPWORDS.has(w))
    );
  }
  function streetWordsMatch(needleWords, hayWords){
    if (needleWords.size === 0) return false;
    for (const w of needleWords) {
      if (!hayWords.has(w)) return false;
    }
    return true;
  }

  // First tried only among tickets that still need a report (same
  // "active" set the export itself uses) — the common, low-ambiguity
  // case: freshly-arrived paperwork for a ticket nobody's written
  // anything for yet. Only when THAT comes up empty do we widen to
  // tickets on that street which already have a note too. That
  // second pass matters: without it, a ticket matched by street once
  // (no number written on the form) would stop being findable by
  // street forever the moment it got its first note — so re-uploading
  // the exact same sheet later (nothing on the form having changed)
  // would show it as "no sesizare found" instead of correctly
  // recognizing it as already imported and skipping it (see the
  // unchanged-note check where matches actually get used). Archived
  // stays excluded in both passes — a loose address guess resurrecting
  // an old archived ticket is a real risk a widened pass shouldn't
  // reintroduce. Either pass: more than one candidate on that street
  // is genuinely ambiguous — flagged for the person to resolve by
  // hand (typically by filling in the ticket number) rather than
  // guessed at.
  function findTicketByStreet(street){
    const needleWords = streetWordSet(street);
    const matchesStreet = t => !t.archived && t.address && streetWordsMatch(needleWords, streetWordSet(t.address));

    const freshCandidates = allTickets.filter(t => !t.resolution_note && matchesStreet(t));
    if (freshCandidates.length === 1) return { matched: freshCandidates[0], matchedBy: 'street' };
    if (freshCandidates.length > 1) return { matched: null, matchedBy: 'ambiguous' };

    const alreadyNotedCandidates = allTickets.filter(t => t.resolution_note && matchesStreet(t));
    if (alreadyNotedCandidates.length === 1) return { matched: alreadyNotedCandidates[0], matchedBy: 'street' };
    if (alreadyNotedCandidates.length > 1) return { matched: null, matchedBy: 'ambiguous' };

    return { matched: null, matchedBy: null };
  }

  function buildRepairNote(rowArr, colIndex, observatiiText){
    const parts = [];
    REPAIR_FIELD_GROUPS.forEach(group => {
      const doneLabels = group.fields
        .filter(f => colIndex[f.header] != null && isRepairCellChecked(rowArr[colIndex[f.header]]))
        .map(f => f.label);
      if (doneLabels.length) parts.push(`${group.title}: ${doneLabels.join(', ')}.`);
    });
    if (observatiiText) parts.push(`Observații: ${observatiiText}.`);
    return parts.join(' ');
  }

  const repairSheetInput = document.getElementById('repairSheetInput');
  const importRepairSheetBtn = document.getElementById('importRepairSheetBtn');
  const importRepairSheetBtnOverview = document.getElementById('importRepairSheetBtnOverview');
  if (importRepairSheetBtn && repairSheetInput) {
    importRepairSheetBtn.addEventListener('click', () => repairSheetInput.click());
    // Same hidden file input, triggered from the Prezentare generală
    // icon row too — no separate <input> or parsing logic needed,
    // both rows open the identical import flow below.
    if (importRepairSheetBtnOverview) importRepairSheetBtnOverview.addEventListener('click', () => repairSheetInput.click());

    repairSheetInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const workbook = XLSX.read(evt.target.result, { type: 'array' });
          // Checks every sheet in the file, not just the first one --
          // see REPAIR_SPECIFIC_HEADERS' own comment for why the first
          // sheet (Coperta, if the workbook was returned unmodified
          // alongside it) can't be trusted to be the real repair sheet
          // just because it also has a ticket-number column.
          let rows = null;
          let headerRowIdx = -1;
          for (const sheetName of workbook.SheetNames) {
            const candidateRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
            const idx = candidateRows.findIndex(r =>
              r.some(cell => REPAIR_TICKET_HEADERS.includes(normalizeHeader(cell))) &&
              r.some(cell => REPAIR_SPECIFIC_HEADERS.has(normalizeHeader(cell)))
            );
            if (idx !== -1) {
              rows = candidateRows;
              headerRowIdx = idx;
              break;
            }
          }
          if (!rows) {
            alert('Nu am găsit fișa de remedieri completă în acest fișier — doar coperta? Verificați că ați încărcat fișierul cu foaia "Fisa remedieri" completată de echipa de teren.');
            repairSheetInput.value = '';
            return;
          }
          const headers = rows[headerRowIdx].map(normalizeHeader);
          const colIndex = {};
          headers.forEach((h, i) => { if (h && colIndex[h] == null) colIndex[h] = i; });

          const ticketCol = headers.findIndex(h => REPAIR_TICKET_HEADERS.includes(h));
          const streetCol = headers.findIndex(h => REPAIR_STREET_HEADERS.includes(h));
          const obsCol = headers.findIndex(h => REPAIR_OBS_HEADERS.includes(h));

          repairSkippedUnchangedCount = 0;
          pendingRepairRows = rows.slice(headerRowIdx + 1)
            .map((r, mapIdx) => {
              // Multi-page printed sheets often repeat the header row
              // on later pages (e.g. row 40 has "Nr. Tichet"/"Strada
              // si nr." in it again, not real data). Only the first
              // header row is skipped above via headerRowIdx — a
              // repeated one here would otherwise get misread as a
              // real row with ticket/street text literally equal to
              // the column headers, producing a nonsense "ambiguous"
              // or "not found" entry in the preview. Detected and
              // skipped the same silent way a blank template row is.
              if ((ticketCol >= 0 && REPAIR_TICKET_HEADERS.includes(normalizeHeader(r[ticketCol])))
                || (streetCol >= 0 && REPAIR_STREET_HEADERS.includes(normalizeHeader(r[streetCol])))) {
                return null;
              }
              // Excel/sheet row number (1-indexed, matching what the
              // person sees when they open the file) so a flagged row
              // in the preview can be traced back to the source file
              // instead of just showing a street/ticket value with no
              // way to locate it.
              const sourceRow = headerRowIdx + mapIdx + 2;
              const ticketDigits = ticketCol >= 0 ? extractTicketDigits(r[ticketCol]) : '';
              const street = streetCol >= 0 ? String(r[streetCol] || '').trim() : '';
              // A row is worth looking at if it has either a ticket
              // number or a street — a template row left completely
              // blank (both empty) is silently skipped, same as
              // before.
              if (!ticketDigits && !street) return null;
              const obsText = obsCol >= 0 ? String(r[obsCol] || '').trim() : '';
              const note = buildRepairNote(r, colIndex, obsText);

              // Try the ticket number first when there is one; if
              // that doesn't land a match (missing, mistyped, or
              // just not written down) fall back to the street —
              // matching is based on whichever of the two actually
              // identifies the ticket, not "street only when the
              // number is completely absent". Unlike the street path
              // below, this one does NOT exclude archived tickets —
              // ticket numbers are never reused in this system, so
              // there's no "stale/reused number resurrects the wrong
              // ticket" risk a number match could fall into the way a
              // fuzzy address guess could. Excluding them used to mean
              // a ticket that had already been manually archived (the
              // bulk "Arhivează selectate" flow doesn't require a
              // report first, only the automatic 14-day sweep does —
              // see autoArchiveStaleTickets) could no longer receive
              // its report at all once the field crew's paperwork
              // caught up — shown as "no sesizare found" in the
              // preview even though the ticket plainly still exists.
              // Writing the note doesn't touch archived/status, so the
              // ticket simply stays archived with its report now
              // filled in (flagged in the preview via matchedArchived
              // so it's still a visible, deliberate thing, not a
              // silent write). A ticket that already has a
              // resolution_note is still a valid match too, either
              // way (lets a corrected sheet update an existing note).
              // A ticket number that WAS written down but doesn't match
              // anything real (mistyped, or just wrong) used to fall
              // straight through to the street guess below -- silently
              // attaching the report to a DIFFERENT ticket than the one
              // actually named, with no sign anything was off. That
              // fallback is only safe when the number cell was left
              // blank in the first place (nothing typed to contradict
              // a street guess); a wrong number is flagged for the
              // person to correct instead of being guessed around.
              let matched = null;
              let matchedBy = null;
              let numberNotFound = false;
              if (ticketDigits) {
                matched = allTickets.find(t => extractTicketDigits(t.ticket_number) === ticketDigits) || null;
                if (matched) matchedBy = 'number';
                else numberNotFound = true;
              }
              if (!matched && !numberNotFound && street) {
                const byStreet = findTicketByStreet(street);
                matched = byStreet.matched;
                matchedBy = byStreet.matchedBy;
              }
              // A sheet row can name a ticket number that's since been
              // marked a duplicate of another one -- writing the note
              // there directly would leave it sitting on a ticket
              // nobody looks at instead of the canonical ticket the
              // issue is actually tracked under. Redirect the match
              // itself to the canonical ticket up front, so every
              // check below (archived, already-Terminat, the preview
              // text) reflects the ticket the report is really going
              // to land on, not the duplicate stub.
              const matchedDuplicateNumber = (matched && isDuplicateTicket(matched)) ? matched.ticket_number : null;
              if (matchedDuplicateNumber) {
                matched = getCanonicalTicket(matched) || matched;
              }
              const matchedArchived = !!(matched && matched.archived);

              // A ticket that already has a resolution_note identical
              // to the note this row would produce has already been
              // imported before (a re-uploaded sheet, or the same
              // fișă run twice) — nothing would actually change, so
              // it's dropped instead of cluttering the preview with a
              // row nobody needs to act on. Only a genuinely different
              // note (a correction, or a first-time note) shows up.
              if (matched && matched.resolution_note && matched.resolution_note.trim() === note.trim()) {
                repairSkippedUnchangedCount++;
                return null;
              }

              // A repair report only makes sense on a ticket that's
              // actually marked Terminat — the whole workflow assumes
              // a ticket only reaches this sheet once someone's
              // already closed it. Nothing in the matching above
              // checks that, though, so flag it here instead of
              // writing a note onto a still-Ongoing ticket with no
              // signal anywhere that anything's off.
              const notTerminatYet = !!matched && matched.status !== 'Terminat';

              // Left unchecked by default when the ticket isn't
              // Terminat yet — same "make it a deliberate choice, not
              // a silent default" reasoning as the manual-save warning
              // above. The checkbox itself stays enabled, so checking
              // it is a one-click, explicit "yes, this is intentional."
              //
              // An empty generated note (no box ticked, no observation
              // written) saves as resolution_note: null -- for a ticket
              // that already HAD a real report, that's a silent erase,
              // not an update. Never auto-checked; see the checkbox
              // wiring below for why it also can't just be checked by
              // hand while still blank.
              const noteEmpty = !note.trim();
              return { sourceRow, ticketNumber: ticketDigits, street, note, matched, matchedBy, matchedArchived, matchedDuplicateNumber, notTerminatYet, numberNotFound, noteEmpty, include: !!matched && !notTerminatYet && !noteEmpty };
            })
            .filter(Boolean);

          // Several sheet rows can name the same ticket (a duplicate
          // line, or two different streets both matching the same
          // ticket by number) -- saving all of them concurrently would
          // race, and whichever request happened to finish last would
          // silently win with no indication the others were ever
          // dropped. Only the LAST matching row stays selectable; the
          // earlier ones are flagged and force-excluded so there's
          // never more than one in-flight write per ticket.
          const seenTicketIds = new Set();
          for (let i = pendingRepairRows.length - 1; i >= 0; i--) {
            const row = pendingRepairRows[i];
            if (!row.matched) continue;
            if (seenTicketIds.has(row.matched.id)) {
              row.duplicateTarget = true;
              row.include = false;
            } else {
              seenTicketIds.add(row.matched.id);
            }
          }

          if (pendingRepairRows.length === 0) {
            alert(repairSkippedUnchangedCount > 0
              ? 'Toate rândurile din fișier corespund unor rapoarte deja existente și identice — nimic de actualizat.'
              : 'Niciun rând din fișier are un număr de tichet sau o stradă completată.');
            repairSheetInput.value = '';
            return;
          }
          renderRepairPreview();
        } catch (err) {
          console.error(err);
          alert('Nu am putut citi acest fișier. Verificați că este un .xlsx, .xls sau .csv valid.');
        }
        repairSheetInput.value = '';
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function renderRepairPreview(){
    const wrap = document.getElementById('repairSheetPreview');
    const table = document.getElementById('repairSheetPreviewTable');
    const foundCount = pendingRepairRows.filter(r => r.matched).length;
    table.innerHTML = `
      <thead><tr>
        <th></th><th>Rând Excel</th><th>Nr. tichet</th><th>Stradă (fișă)</th><th>Sesizare găsită</th><th>Ce s-a făcut</th>
      </tr></thead>
      <tbody>
        ${pendingRepairRows.map((r, i) => `
          <tr class="${!r.matched || r.duplicateTarget ? 'row-error' : r.notTerminatYet || r.noteEmpty ? 'row-warning' : ''}">
            <td><input type="checkbox" class="repair-row-include" data-idx="${i}" ${r.include ? 'checked' : ''} ${(r.matched && !r.noteEmpty && !r.duplicateTarget) ? '' : 'disabled'}></td>
            <td>${r.sourceRow}</td>
            <td>${r.ticketNumber ? escapeHtml(r.ticketNumber) : '<em>(după stradă)</em>'}</td>
            <td>${escapeHtml(r.street) || '—'}</td>
            <td>${r.matched
              ? escapeHtml(r.matched.address || '—')
                + (r.matchedBy === 'street' ? ' <strong>(găsit după adresă — verificați)</strong>' : '')
                + (r.matched.resolution_note ? ' <strong>(are deja raport — va fi înlocuit)</strong>' : '')
                + (r.matchedArchived ? ' <strong>(tichet arhivat — rămâne arhivat, doar raportul e actualizat)</strong>' : '')
                + (r.matchedDuplicateNumber ? ` <strong>(${escapeHtml(r.matchedDuplicateNumber)} e duplicat al ${escapeHtml(r.matched.ticket_number)} — raportul va fi salvat pe sesizarea originală)</strong>` : '')
                + (r.notTerminatYet ? ' <strong>(tichetul e încă Activ — nu va fi marcat automat ca soluționat, bifați doar dacă e intenționat)</strong>' : '')
                + (r.noteEmpty ? ' <strong>(nicio căsuță bifată sau observație — nu va fi salvat, ar șterge un raport existent)</strong>' : '')
                + (r.duplicateTarget ? ' <strong>(alt rând din fișier vizează aceeași sesizare — verificați și bifați doar unul)</strong>' : '')
              : r.numberNotFound
                ? `Numărul "${escapeHtml(r.ticketNumber)}" nu corespunde niciunui tichet — verificați dacă e scris corect`
                : r.matchedBy === 'ambiguous'
                ? 'Mai multe sesizări active pe această stradă — completați numărul de tichet'
                : 'Nu a fost găsită nicio sesizare'}</td>
            <td><textarea class="repair-note-input" data-idx="${i}" rows="2" ${r.matched ? '' : 'disabled'}>${escapeHtml(r.note)}</textarea></td>
          </tr>
        `).join('')}
      </tbody>
    `;
    document.getElementById('repairSheetPreviewNote').textContent =
      `Previzualizare — ${foundCount} din ${pendingRepairRows.length} rânduri au fost asociate unei sesizări existente. Debifați un rând pentru a-l exclude, sau editați textul înainte de a confirma.`
      + (repairSkippedUnchangedCount > 0
        ? ` (${repairSkippedUnchangedCount} rând${repairSkippedUnchangedCount === 1 ? '' : 'uri'} cu raport identic celui existent ${repairSkippedUnchangedCount === 1 ? 'a fost omis' : 'au fost omise'} automat.)`
        : '');
    table.querySelectorAll('.repair-row-include').forEach(cb => {
      cb.addEventListener('change', () => {
        pendingRepairRows[Number(cb.dataset.idx)].include = cb.checked;
      });
    });
    table.querySelectorAll('.repair-note-input').forEach(ta => {
      ta.addEventListener('input', () => {
        const idx = Number(ta.dataset.idx);
        const row = pendingRepairRows[idx];
        row.note = ta.value;
        // Edited live, not just at initial preview build -- typing a
        // note into a row that came in blank (or clearing one back
        // out) must immediately re-lock the checkbox, since the
        // "never save an empty note" protection has to hold no matter
        // when the box ends up empty, not just at the moment the file
        // was first read.
        row.noteEmpty = !ta.value.trim();
        const cb = table.querySelector(`.repair-row-include[data-idx="${idx}"]`);
        if (cb && !row.duplicateTarget) {
          cb.disabled = row.noteEmpty;
          if (row.noteEmpty) { cb.checked = false; row.include = false; }
        }
      });
    });
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const repairSheetCancelBtn = document.getElementById('repairSheetCancelBtn');
  if (repairSheetCancelBtn) {
    repairSheetCancelBtn.addEventListener('click', () => {
      pendingRepairRows = [];
      document.getElementById('repairSheetPreview').style.display = 'none';
    });
  }

  const repairSheetConfirmBtn = document.getElementById('repairSheetConfirmBtn');
  if (repairSheetConfirmBtn) {
    repairSheetConfirmBtn.addEventListener('click', async () => {
      // Defense in depth, not the only guard -- the checkbox is
      // already locked disabled+unchecked for an empty note or a
      // duplicate-target row, but this is the one place that actually
      // writes to the database, so it re-checks both conditions itself
      // rather than trusting the checkbox's DOM state alone.
      const toSave = pendingRepairRows.filter(r => r.matched && r.include && r.note.trim() !== '' && !r.duplicateTarget);
      if (toSave.length === 0) {
        alert('Niciun rând selectat de salvat.');
        return;
      }
      repairSheetConfirmBtn.disabled = true;
      repairSheetConfirmBtn.textContent = 'Se salvează...';
      const results = await Promise.allSettled(toSave.map(r =>
        AppDataServices.tickets.saveResolutionNote(supabaseClient, r.matched.id, r.note.trim())
      ));
      let failCount = 0;
      results.forEach(result => {
        const error = result.status === 'fulfilled' ? result.value.error : result.reason;
        if (error) { console.error(error); failCount++; }
      });
      repairSheetConfirmBtn.disabled = false;
      repairSheetConfirmBtn.textContent = 'Confirmă și salvează';
      pendingRepairRows = [];
      document.getElementById('repairSheetPreview').style.display = 'none';
      if (failCount > 0) {
        alert(`${failCount} rapoarte nu au putut fi salvate. Încercați din nou.`);
      } else {
        showToast(`${toSave.length} rapoarte au fost salvate.`);
      }
      loadTickets();
    });
  }

  