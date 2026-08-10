/* ================================================================
   i18n.js -- shared translation system for insta-grup.ro
   ----------------------------------------------------------------
   Used by: index.html, proiecte.html, sesizari.html
   NOT used by: admin.html (stays Romanian-only, no switcher, by design)

   How it works:
     - Default language is Romanian ("ro") on a visitor's first ever
       visit. Once someone picks a language via the RO/EN/HU switcher
       in the header, that choice is remembered in localStorage and
       used on every page and every future visit in that browser.
     - Elements are translated via data attributes, not by duplicating
       markup per language:
         data-i18n="key"             -> sets element.textContent
         data-i18n-html="key"        -> sets element.innerHTML (only
                                          use this where the translation
                                          value intentionally contains
                                          markup, e.g. the hero <em>)
         data-i18n-placeholder="key" -> sets the placeholder attribute
         data-i18n-aria="key"        -> sets the aria-label attribute
     - Call applyTranslations() once on load (done automatically below)
       and again any time a page dynamically injects new translatable
       content (e.g. after rendering ticket cards) -- see the
       "window.dispatchEvent(new CustomEvent('langchange'))" pattern:
       each page's own script can listen for 'langchange' and re-run
       whatever function builds its dynamic content.

   What is intentionally NOT translated here (see chat notes):
     - The GDPR notice and Terms & Conditions body text (legal
       documents -- left Romanian-only; a note is shown in EN/HU
       pointing back to the Romanian original instead of guessing
       at a legally-accurate translation).
     - The ~70 individual project records in proiecte.html (factual
       historical data, not UI chrome).
     - Any data a visitor or admin actually typed in (ticket names,
       addresses, descriptions, etc.) -- only ever shown as entered.
   ================================================================ */

const I18N = {

ro: {
  // Nav
  nav_despre: "Despre noi",
  nav_servicii: "Servicii",
  nav_proiecte: "Proiecte",
  nav_contact: "Contact",
  nav_modernizare: "Proiecte de modernizare",
  nav_cta: "Sesizări iluminat public",

  // Hero
  hero_eyebrow: "Insta Grup S.A. · din 1997 · Târgu-Mureș",
  hero_h1_html: "Infrastructură&nbsp;<em>pentru generații</em>.",
  hero_lede: "Proiectare și execuție de instalații electrice, rețele de utilități și infrastructură industrială pentru autorități publice, utilități și clienți corporate din județul Mureș.",

  // Stats
  stat_1_label: "ani de activitate neîntreruptă în domeniu",
  stat_2_label: "proiecte finalizate în județul Mureș",
  stat_3_label: "atestări și certificări ISO / ANRE / ANRSC",
  stat_4_label: "clienți parteneri pe termen lung",

  // About
  about_eyebrow: "Despre noi",
  about_h2: "25 de ani de proiecte duse la bun sfârșit",
  about_p1: "Proiectate şi dezvoltate pentru mediul concurenţial, produsele şi serviciile firmei au reuşit să se impună pe anumite segmente ale pieţei din judeţul Mureş şi din împrejurimi. De la înfiinţarea societăţii, în 1997, am dus la bun sfârşit peste 150 de proiecte în domeniul instalaţiilor electrice, reţelelor de utilităţi şi infrastructurii industriale.",
  about_p2: "Beneficiarii care au intrat în portofoliul firmei noastre au făcut-o ca urmare a relaţiilor pe care echipa managerială le-a promovat în timp şi a unei strategii orientate constant către parteneriate pe termen lung.",
  about_slide1_cap: "Stație de transformare electrică",
  about_slide2_cap: "Rețele electrice de înaltă tensiune",
  about_slide3_cap: "Instalații fotovoltaice",
  about_slide4_cap: "Rețele de apă și canalizare",

  // Services section head
  svc_eyebrow: "Servicii oferite",
  svc_h2: "Șapte domenii, o singură echipă",
  svc_lede: "De la proiectare la execuție și mentenanță — acoperim întregul ciclu al lucrărilor de infrastructură electrică și utilități.",
  svc_hint: "Vezi detalii",

  // Service cards
  svc1_tag: "Rețele electrice", svc1_title: "Linii și posturi de transformare",
  svc1_i1: "Linii electrice aeriene şi subterane, 0,4–110 kV",
  svc1_i2: "Posturi de transformare de medie tensiune",
  svc1_i3: "Modernizare şi îmbunătăţire de tensiune",

  svc2_tag: "Alimentări", svc2_title: "Instalații electrice civile & industriale",
  svc2_i1: "Instalaţii electrice interioare/exterioare civile",
  svc2_i2: "Instalaţii electrice interioare/exterioare industriale",
  svc2_i3: "Branşamente electrice aeriene şi subterane",

  svc3_tag: "Iluminat public", svc3_title: "Rețele de iluminat stradal",
  svc3_i1: "Rețele electrice de iluminat public aeriene/subterane",
  svc3_i2: "Lucrări de mentenanță la corpurile de iluminat",
  svc3_i3: "Instalații de iluminat nocturn pietonal și rutier",

  svc4_tag: "Fotovoltaic", svc4_title: "Racorduri și instalații solare",
  svc4_i1: "Instalaţii electrice interioare centrale fotoelectrice",
  svc4_i2: "Racord electric LES 20 kV + 0,4 kV parcuri solare",

  svc5_tag: "Apă-canal", svc5_title: "Rețele de apă și canalizare",
  svc5_i1: "Reabilitare și înlocuire conducte de apă",
  svc5_i2: "Extindere sisteme de irigații",
  svc5_i3: "Rețele subterane de transfer de informație",

  svc6_tag: "Fibră optică", svc6_title: "Canalizații pentru telecomunicații",
  svc6_i1: "Canalizaţii reţele subterane transfer informaţie",
  svc6_i2: "Montare canalizaţie fibră optică",

  svc7_tag: "Automatizări", svc7_title: "Comandă, control și protecție",
  svc7_i1: "Instalaţii electrice de curenţi slabi",
  svc7_i2: "Instalaţii de comandă, control şi protecţii prin relee",
  svc7_i3: "Măsurarea rezistenţei de izolaţie şi continuitate",

  // Projects map section
  proj_eyebrow: "Lucrări de referință",
  proj_h2: "Proiecte realizate în județul Mureș",
  proj_lede: "O selecție din lucrările noastre, poziționate geografic. Treceți cursorul peste un punct pentru detalii.",
  proj_map_full_label_html: "Județul Mureș — <strong>18 din 150+ proiecte</strong>",
  proj_map_updated: "Actualizat 2026",
  proj_footer_note: "Toate lucrările sunt organizate și pe categorii, pentru o parcurgere mai rapidă.",
  proj_archive_btn: "Vezi arhiva completă →",

  // Current projects section ("Ce facem acum")
  current_eyebrow: "Lucrări în derulare",
  current_h2: "Ce facem acum",
  current_lede: "O privire asupra proiectelor aflate în desfășurare în acest moment, actualizată periodic de echipa noastră.",
  current_empty: "Momentan nu sunt proiecte active afișate.",
  current_status_scheduled: "Programat",
  current_status_progress: "În desfășurare",
  current_status_done: "Finalizat",
  current_progress_label: "Progres estimat",
  current_k_start: "Început",
  current_k_due: "Finalizare estimată",
  hub_tag: "Sediu",
  hub_title: "Insta Grup S.A.",
  hub_desc: "Str. Căminului nr. 35, Târgu-Mureș",

  mp1_tag: "Fotovoltaic", mp1_title: "Parc fotovoltaic Agrişteu", mp1_desc: "Racord electric LES 20 kV + 0,4 kV pentru parcul fotovoltaic.",
  mp2_tag: "Rețele electrice", mp2_title: "Zona Industrială Tg. Mureș", mp2_desc: "Trecere la 20 kV — 20 km de linii electrice subterane.",
  mp3_tag: "Rețele electrice", mp3_title: "Modernizare zonă centrală", mp3_desc: "Trecerea liniilor electrice aeriene în subteran, Tg. Mureș.",
  mp4_tag: "Apă-canal", mp4_title: "Reabilitare conductă Valea Rece", mp4_desc: "Înlocuirea conductei de apă potabilă pe traseul Valea Rece.",
  mp5_tag: "Rețele electrice", mp5_title: "Stația Sânpaul", mp5_desc: "Mărirea gradului de siguranță în alimentare la stația 110 kV.",
  mp6_tag: "Alimentări", mp6_title: "Hala Hirschmann TM1/TM2", mp6_desc: "Alimentare și spor de putere pentru halele de producție.",
  mp7_tag: "Iluminat public", mp7_title: "Reabilitare iluminat Cristești", mp7_desc: "Modernizarea trecerilor de pietoni și a iluminatului stradal.",
  mp8_tag: "Fibră optică", mp8_title: "Canalizații Tg. Mureș", mp8_desc: "Canalizații subterane pentru transfer de informație.",
  mp9_tag: "Alimentări", mp9_title: "Complex comercial Belrom Unu", mp9_desc: "Alimentare cu energie electrică, etapa I, Tg. Mureș.",
  mp10_tag: "Rețele electrice", mp10_title: "LEA 110 kV Fântânele–Sovata", mp10_desc: "Înlocuire izolație la traversări pe linia de înaltă tensiune.",
  mp11_tag: "Alimentări", mp11_title: "Spital Județean de Urgență", mp11_desc: "Creare stradă de legătură și alimentare electrică aferentă.",
  mp12_tag: "Rețele electrice", mp12_title: "Îmbunătățire tensiune Sânpaul", mp12_desc: "Mărire grad de siguranță prin injecție din stația Sânpaul.",
  mp13_tag: "Iluminat public", mp13_title: "Iluminat stradal Gh. Doja", mp13_desc: "Sens giratoriu și iluminat pentru complex comercial retail.",
  mp14_tag: "Alimentări", mp14_title: "Hală producție Prolemn Reghin", mp14_desc: "Instalații electrice iluminat și protecție la trăsnet, fabrica PAL/MDF.",
  mp15_tag: "Rețele electrice", mp15_title: "LEA 20 kV Râciu–Sărmaş", mp15_desc: "Înlocuire izolație pe linia electrică aeriană de medie tensiune.",
  mp16_tag: "Automatizări", mp16_title: "Depozite Kastamonu Romania", mp16_desc: "Instalație de paratrăsnet, zona depozite lemn și birouri.",
  mp17_tag: "Apă-canal", mp17_title: "Extindere irigații CASM", mp17_desc: "Extindere sistem de irigații în incinta CASM.",
  mp18_tag: "Fibră optică", mp18_title: "Rețea Vodafone", mp18_desc: "Montare canalizație pentru fibră optică.",

  // Ticket report section
  report_eyebrow: "Sesizări iluminat public",
  report_h2: "Raportează o problemă",
  report_lede: "Sesizați o defecțiune de funcționalitate sau un accident/urgență la rețeaua de iluminat public. Fiecare sesizare primește un număr de înregistrare.",
  report_all_btn: "Toate sesizările →",
  step1_label: "01 · Tip sesizare",
  step2_label: "02 · Detalii",
  type_func_title: "Problemă de funcționalitate",
  type_func_desc: "Bec ars, stâlp defect, cablu vizibil deteriorat sau altă problemă care nu reprezintă un pericol imediat.",
  type_accident_title: "Accident / urgență",
  type_accident_desc: "Stâlp căzut, cabluri sub tensiune expuse sau orice situație cu pericol imediat pentru siguranța publică.",
  emergency_title: "Pericol imediat? Sunați acum",
  emergency_desc: "Pentru urgențe cu risc pentru siguranța publică, sunați direct — nu așteptați procesarea formularului.",
  f_name_label: "Nume",
  f_name_ph: "Numele dvs.",
  f_phone_label: "Telefon",
  f_phone_ph: "07xx xxx xxx",
  f_email_label_html: "Email <span class=\"opt\">(opțional)</span>",
  f_email_ph: "nume@exemplu.ro",
  f_address_label: "Adresa unde este problema",
  f_address_ph: "Stradă, număr, localitate",
  f_desc_label: "Descrierea problemei",
  f_desc_ph: "Descrieți pe scurt ce ați observat...",
  back_link: "← Înapoi",
  submit_btn: "Trimite sesizarea →",
  submit_btn_sending: "Se trimite...",
  submit_success_html: "Sesizarea a fost înregistrată cu numărul {num}. Vă mulțumim!",
  submit_error: "A apărut o eroare la trimiterea sesizării. Vă rugăm încercați din nou sau sunați la 0265 253 997.",
  select_type_error: "Selectați mai întâi tipul sesizării.",

  // Contact section
  contact_eyebrow: "Contact",
  contact_h2: "Aveți un proiect în derulare?",
  contact_lede: "Spuneți-ne despre lucrare — răspundem cu o estimare de timp și cost în cel mult 2 zile lucrătoare.",
  contact_k_sediu: "Sediu",
  contact_v_sediu: "Str. Căminului nr. 35, Târgu-Mureș, jud. Mureș",
  contact_k_telefon: "Telefon",
  contact_v_telefon: "+40 265 000 000",
  contact_k_email: "Email",
  contact_v_email: "office@insta-grup.ro",
  contact_k_program: "Program",
  contact_v_program: "Luni – Vineri, 08:00 – 16:00",
  cf_name_label: "Nume",
  cf_name_ph: "Numele dvs.",
  cf_email_label: "Email",
  cf_email_ph: "nume@companie.ro",
  cf_message_label: "Detalii proiect",
  cf_message_ph: "Descrieți pe scurt lucrarea...",
  cf_submit_btn: "Trimite solicitarea",
  cf_submit_sending: "Se trimite...",
  cf_success: "Mulțumim! Solicitarea dvs. a fost trimisă.",
  cf_error: "A apărut o eroare la trimitere. Vă rugăm încercați din nou sau sunați la 0265 253 997.",

  // Footer
  footer_copy: "© 2026 Insta Grup S.A. Toate drepturile rezervate.",
  footer_gdpr: "Politica de confidențialitate (GDPR)",
  footer_tc: "Termeni și Condiții",
  footer_location: "Târgu-Mureș, România",
  legal_ro_only_note: "Acest document este disponibil oficial doar în limba română.",

  // Ticket status vocabulary (shared with sesizari.html / dynamic labels)
  ticket_type_func: "Funcționalitate",
  ticket_type_accident: "Accident",
  ticket_status_active: "Activ",
  ticket_status_done: "Rezolvat",

  // proiecte.html
  archive_eyebrow: "Arhivă completă",
  archive_h1: "Toate proiectele realizate în județul Mureș",
  archive_lede: "Peste 25 de ani de activitate — o listă completă a lucrărilor duse la bun sfârșit, din 1997 până astăzi. Filtrați după categorie sau căutați un proiect anume.",
  archive_back: "← Înapoi la proiecte de referință",
  archive_search_ph: "Caută un proiect (ex: Sânpaul, LEA, fibră optică)...",
  archive_search_aria: "Caută un proiect",
  archive_cat_all: "Toate",
  archive_cat_retele: "Rețele electrice",
  archive_cat_alimentari: "Alimentări",
  archive_cat_iluminat: "Iluminat public",
  archive_cat_apa: "Apă-canal",
  archive_cat_fibra: "Fibră optică",
  archive_cat_foto: "Fotovoltaic",
  archive_cat_automat: "Automatizări",
  archive_count_of: "{n} din {total} proiecte afișate",
  archive_no_results: "Niciun proiect găsit. Încercați alți termeni de căutare.",
  archive_data_note: "Descrierile proiectelor de mai jos sunt păstrate în limba română, ca înregistrări istorice originale.",

  // sesizari.html
  public_eyebrow: "Sesizări iluminat public",
  public_h1: "Situația sesizărilor curente",
  public_lede: "O listă publică a sesizărilor de iluminat public transmise prin site — pentru transparență, fără date personale ale celor care au raportat problema.",
  public_back: "← Raportează o problemă nouă",
  public_search_ph: "Caută după adresă sau număr tichet...",
  public_search_aria: "Caută o sesizare",
  public_chip_active: "Active",
  public_chip_done: "Rezolvate",
  public_count: "{n} sesizări",
  public_no_results: "Nicio sesizare în această categorie.",
  public_load_error: "Eroare la încărcarea sesizărilor. Reîncercați.",
  public_k_date: "Data raportării",
  public_k_address: "Adresă",
  public_k_desc: "Descrierea problemei",
  public_k_resolved: "Data rezolvării",
  public_k_work_done: "Ce s-a făcut",
  public_before: "Înainte",
  public_after: "După",
},

en: {
  nav_despre: "About us",
  nav_servicii: "Services",
  nav_proiecte: "Projects",
  nav_contact: "Contact",
  nav_modernizare: "Modernization projects",
  nav_cta: "Report a streetlight issue",

  hero_eyebrow: "Insta Grup S.A. · since 1997 · Târgu-Mureș",
  hero_h1_html: "Infrastructure&nbsp;<em>for generations</em>.",
  hero_lede: "Design and execution of electrical installations, utility networks and industrial infrastructure for public authorities, utility companies and corporate clients across Mureș County.",

  stat_1_label: "years of continuous activity in the field",
  stat_2_label: "completed projects in Mureș County",
  stat_3_label: "ISO / ANRE / ANRSC attestations and certifications",
  stat_4_label: "long-term partner clients",

  about_eyebrow: "About us",
  about_h2: "25 years of projects delivered",
  about_p1: "Designed and developed for a competitive market, the company's products and services have established a strong position in certain segments of the market in Mureș County and the surrounding area. Since the company was founded in 1997, we have completed over 150 projects in electrical installations, utility networks and industrial infrastructure.",
  about_p2: "The clients who have joined our company's portfolio have done so as a result of the relationships our management team has built over time and a strategy consistently oriented towards long-term partnerships.",
  about_slide1_cap: "Electrical substation",
  about_slide2_cap: "High-voltage electrical networks",
  about_slide3_cap: "Photovoltaic installations",
  about_slide4_cap: "Water and sewage networks",

  svc_eyebrow: "Services offered",
  svc_h2: "Seven domains, one team",
  svc_lede: "From design to execution and maintenance — we cover the entire lifecycle of electrical infrastructure and utility works.",
  svc_hint: "See details",

  svc1_tag: "Electrical networks", svc1_title: "Power lines and transformer stations",
  svc1_i1: "Overhead and underground power lines, 0.4–110 kV",
  svc1_i2: "Medium-voltage transformer stations",
  svc1_i3: "Voltage upgrades and modernization",

  svc2_tag: "Power supply", svc2_title: "Civil & industrial electrical installations",
  svc2_i1: "Indoor/outdoor electrical installations, civil buildings",
  svc2_i2: "Indoor/outdoor electrical installations, industrial buildings",
  svc2_i3: "Overhead and underground electrical connections",

  svc3_tag: "Public lighting", svc3_title: "Street lighting networks",
  svc3_i1: "Overhead/underground public lighting networks",
  svc3_i2: "Maintenance work on lighting fixtures",
  svc3_i3: "Pedestrian and road night-lighting installations",

  svc4_tag: "Photovoltaic", svc4_title: "Solar connections and installations",
  svc4_i1: "Indoor electrical installations for solar power plants",
  svc4_i2: "20 kV + 0.4 kV LES electrical connections for solar parks",

  svc5_tag: "Water & sewage", svc5_title: "Water and sewage networks",
  svc5_i1: "Rehabilitation and replacement of water pipes",
  svc5_i2: "Extension of irrigation systems",
  svc5_i3: "Underground data-transfer networks",

  svc6_tag: "Fiber optic", svc6_title: "Telecommunications ducting",
  svc6_i1: "Underground ducting for data-transfer networks",
  svc6_i2: "Fiber-optic ducting installation",

  svc7_tag: "Automation", svc7_title: "Control and protection systems",
  svc7_i1: "Low-current electrical installations",
  svc7_i2: "Relay-based control and protection installations",
  svc7_i3: "Insulation resistance and continuity testing",

  proj_eyebrow: "Reference works",
  proj_h2: "Projects completed in Mureș County",
  proj_lede: "A selection of our projects, shown by location. Hover over a point for details.",
  proj_map_full_label_html: "Mureș County — <strong>18 of 150+ projects</strong>",
  proj_map_updated: "Updated 2026",
  proj_footer_note: "All our projects are also organized by category, for quicker browsing.",
  proj_archive_btn: "View the full archive →",

  // Current projects section
  current_eyebrow: "Ongoing works",
  current_h2: "What we're doing now",
  current_lede: "A look at the projects currently in progress, updated periodically by our team.",
  current_empty: "No active projects shown at the moment.",
  current_status_scheduled: "Scheduled",
  current_status_progress: "In progress",
  current_status_done: "Completed",
  current_progress_label: "Estimated progress",
  current_k_start: "Started",
  current_k_due: "Estimated completion",
  hub_tag: "Headquarters",
  hub_title: "Insta Grup S.A.",
  hub_desc: "35 Căminului St., Târgu-Mureș",

  mp1_tag: "Photovoltaic", mp1_title: "Agrişteu solar park", mp1_desc: "20 kV + 0.4 kV LES electrical connection for the solar park.",
  mp2_tag: "Electrical networks", mp2_title: "Tg. Mureș Industrial Zone", mp2_desc: "Conversion to 20 kV — 20 km of underground power lines.",
  mp3_tag: "Electrical networks", mp3_title: "City-center modernization", mp3_desc: "Converting overhead power lines to underground, Tg. Mureș.",
  mp4_tag: "Water & sewage", mp4_title: "Valea Rece pipe rehabilitation", mp4_desc: "Replacement of the drinking-water pipe along the Valea Rece route.",
  mp5_tag: "Electrical networks", mp5_title: "Sânpaul substation", mp5_desc: "Increasing supply reliability at the 110 kV substation.",
  mp6_tag: "Power supply", mp6_title: "Hirschmann TM1/TM2 plant", mp6_desc: "Power supply and capacity increase for the production halls.",
  mp7_tag: "Public lighting", mp7_title: "Cristești lighting rehabilitation", mp7_desc: "Modernization of pedestrian crossings and street lighting.",
  mp8_tag: "Fiber optic", mp8_title: "Tg. Mureș ducting", mp8_desc: "Underground ducting for data-transfer networks.",
  mp9_tag: "Power supply", mp9_title: "Belrom Unu commercial complex", mp9_desc: "Electrical power supply, phase I, Tg. Mureș.",
  mp10_tag: "Electrical networks", mp10_title: "110 kV line Fântânele–Sovata", mp10_desc: "Insulation replacement at crossings on the high-voltage line.",
  mp11_tag: "Power supply", mp11_title: "County Emergency Hospital", mp11_desc: "New connecting street and associated power supply.",
  mp12_tag: "Electrical networks", mp12_title: "Sânpaul voltage upgrade", mp12_desc: "Increasing supply reliability via injection from Sânpaul substation.",
  mp13_tag: "Public lighting", mp13_title: "Gh. Doja street lighting", mp13_desc: "Roundabout and lighting for a retail commercial complex.",
  mp14_tag: "Power supply", mp14_title: "Prolemn Reghin production hall", mp14_desc: "Lighting and lightning-protection installations, PAL/MDF plant.",
  mp15_tag: "Electrical networks", mp15_title: "20 kV line Râciu–Sărmaş", mp15_desc: "Insulation replacement on the medium-voltage overhead line.",
  mp16_tag: "Automation", mp16_title: "Kastamonu Romania warehouses", mp16_desc: "Lightning-protection installation, timber-warehouse and office zone.",
  mp17_tag: "Water & sewage", mp17_title: "CASM irrigation extension", mp17_desc: "Extension of the irrigation system on the CASM premises.",
  mp18_tag: "Fiber optic", mp18_title: "Vodafone network", mp18_desc: "Installation of fiber-optic ducting.",

  report_eyebrow: "Report a streetlight issue",
  report_h2: "Report a problem",
  report_lede: "Report a functionality issue or an accident/emergency on the public lighting network. Every report receives a registration number.",
  report_all_btn: "All reports →",
  step1_label: "01 · Issue type",
  step2_label: "02 · Details",
  type_func_title: "Functionality issue",
  type_func_desc: "Burnt-out bulb, damaged pole, visibly damaged cable, or another issue that isn't an immediate danger.",
  type_accident_title: "Accident / emergency",
  type_accident_desc: "Fallen pole, exposed live cables, or any situation posing an immediate danger to public safety.",
  emergency_title: "Immediate danger? Call now",
  emergency_desc: "For emergencies posing a risk to public safety, call directly — don't wait for the form to be processed.",
  f_name_label: "Name",
  f_name_ph: "Your name",
  f_phone_label: "Phone",
  f_phone_ph: "07xx xxx xxx",
  f_email_label_html: "Email <span class=\"opt\">(optional)</span>",
  f_email_ph: "name@example.com",
  f_address_label: "Address of the issue",
  f_address_ph: "Street, number, town",
  f_desc_label: "Description of the issue",
  f_desc_ph: "Briefly describe what you noticed...",
  back_link: "← Back",
  submit_btn: "Submit report →",
  submit_btn_sending: "Sending...",
  submit_success_html: "Your report has been registered with number {num}. Thank you!",
  submit_error: "An error occurred while submitting your report. Please try again or call 0265 253 997.",
  select_type_error: "Please select the issue type first.",

  contact_eyebrow: "Contact",
  contact_h2: "Have a project in mind?",
  contact_lede: "Tell us about the work — we'll respond with a time and cost estimate within 2 business days.",
  contact_k_sediu: "Address",
  contact_v_sediu: "35 Căminului St., Târgu-Mureș, Mureș County",
  contact_k_telefon: "Phone",
  contact_v_telefon: "+40 265 000 000",
  contact_k_email: "Email",
  contact_v_email: "office@insta-grup.ro",
  contact_k_program: "Hours",
  contact_v_program: "Monday – Friday, 08:00 – 16:00",
  cf_name_label: "Name",
  cf_name_ph: "Your name",
  cf_email_label: "Email",
  cf_email_ph: "name@company.com",
  cf_message_label: "Project details",
  cf_message_ph: "Briefly describe the project...",
  cf_submit_btn: "Send request",
  cf_submit_sending: "Sending...",
  cf_success: "Thank you! Your request has been sent.",
  cf_error: "An error occurred while sending. Please try again or call 0265 253 997.",

  footer_copy: "© 2026 Insta Grup S.A. All rights reserved.",
  footer_gdpr: "Privacy Policy (GDPR)",
  footer_tc: "Terms & Conditions",
  footer_location: "Târgu-Mureș, Romania",
  legal_ro_only_note: "This document is officially available in Romanian only.",

  ticket_type_func: "Functionality",
  ticket_type_accident: "Accident",
  ticket_status_active: "Active",
  ticket_status_done: "Resolved",

  archive_eyebrow: "Full archive",
  archive_h1: "All projects completed in Mureș County",
  archive_lede: "Over 25 years of activity — a complete list of completed works, from 1997 to today. Filter by category or search for a specific project.",
  archive_back: "← Back to reference projects",
  archive_search_ph: "Search a project (e.g. Sânpaul, LEA, fiber optic)...",
  archive_search_aria: "Search a project",
  archive_cat_all: "All",
  archive_cat_retele: "Electrical networks",
  archive_cat_alimentari: "Power supply",
  archive_cat_iluminat: "Public lighting",
  archive_cat_apa: "Water & sewage",
  archive_cat_fibra: "Fiber optic",
  archive_cat_foto: "Photovoltaic",
  archive_cat_automat: "Automation",
  archive_count_of: "{n} of {total} projects shown",
  archive_no_results: "No project found. Try different search terms.",
  archive_data_note: "Project descriptions below are kept in Romanian, as the original historical records.",

  public_eyebrow: "Streetlight reports",
  public_h1: "Current status of reports",
  public_lede: "A public list of public-lighting reports submitted through the site — for transparency, with no personal data of the people who reported the issue.",
  public_back: "← Report a new problem",
  public_search_ph: "Search by address or report number...",
  public_search_aria: "Search a report",
  public_chip_active: "Active",
  public_chip_done: "Resolved",
  public_count: "{n} reports",
  public_no_results: "No reports in this category.",
  public_load_error: "Error loading reports. Please try again.",
  public_k_date: "Reported on",
  public_k_address: "Address",
  public_k_desc: "Description of the issue",
  public_k_resolved: "Resolved on",
  public_k_work_done: "Work done",
  public_before: "Before",
  public_after: "After",
},

hu: {
  nav_despre: "Rólunk",
  nav_servicii: "Szolgáltatások",
  nav_proiecte: "Projektek",
  nav_contact: "Kapcsolat",
  nav_modernizare: "Korszerűsítési projektek",
  nav_cta: "Közvilágítási hibabejelentés",

  hero_eyebrow: "Insta Grup S.A. · 1997 óta · Marosvásárhely",
  hero_h1_html: "Infrastruktúra&nbsp;<em>generációknak</em>.",
  hero_lede: "Villamos hálózatok, közműhálózatok és ipari infrastruktúra tervezése és kivitelezése önkormányzatok, közműszolgáltatók és vállalati ügyfelek számára Maros megyében.",

  stat_1_label: "év folyamatos tevékenység a szakterületen",
  stat_2_label: "befejezett projekt Maros megyében",
  stat_3_label: "ISO / ANRE / ANRSC tanúsítvány",
  stat_4_label: "hosszú távú partner ügyfél",

  about_eyebrow: "Rólunk",
  about_h2: "25 év sikeresen lezárt projekt",
  about_p1: "A versenyképes piaci környezetre tervezett termékeink és szolgáltatásaink erős pozíciót vívtak ki Maros megye és a környező térség piacának egyes szegmenseiben. 1997-es alapításunk óta több mint 150 projektet valósítottunk meg villamos hálózatok, közműhálózatok és ipari infrastruktúra területén.",
  about_p2: "Ügyfélportfóliónk azoknak a kapcsolatoknak köszönhetően bővült, amelyeket vezetőségünk az évek során kiépített, valamint a hosszú távú partnerségekre irányuló, következetes stratégiánknak köszönhetően.",
  about_slide1_cap: "Elektromos transzformátorállomás",
  about_slide2_cap: "Nagyfeszültségű villamos hálózatok",
  about_slide3_cap: "Napelemes rendszerek",
  about_slide4_cap: "Víz- és csatornahálózatok",

  svc_eyebrow: "Szolgáltatásaink",
  svc_h2: "Hét szakterület, egy csapat",
  svc_lede: "A tervezéstől a kivitelezésen át a karbantartásig — a villamos infrastruktúra és közműmunkák teljes körű lefedése.",
  svc_hint: "Részletek",

  svc1_tag: "Villamos hálózatok", svc1_title: "Vezetékek és transzformátorállomások",
  svc1_i1: "Föld feletti és földalatti villamos vezetékek, 0,4–110 kV",
  svc1_i2: "Középfeszültségű transzformátorállomások",
  svc1_i3: "Feszültségszint korszerűsítése és javítása",

  svc2_tag: "Áramellátás", svc2_title: "Lakossági és ipari villamos berendezések",
  svc2_i1: "Beltéri/kültéri villamos berendezések, lakóépületek",
  svc2_i2: "Beltéri/kültéri villamos berendezések, ipari épületek",
  svc2_i3: "Föld feletti és földalatti villamos bekötések",

  svc3_tag: "Közvilágítás", svc3_title: "Közúti közvilágítási hálózatok",
  svc3_i1: "Föld feletti/földalatti közvilágítási hálózatok",
  svc3_i2: "Világítótestek karbantartási munkái",
  svc3_i3: "Gyalogos- és úti éjszakai világítási rendszerek",

  svc4_tag: "Napelemes rendszerek", svc4_title: "Napelemes csatlakozások és rendszerek",
  svc4_i1: "Napelemes erőművek beltéri villamos berendezései",
  svc4_i2: "20 kV + 0,4 kV LES villamos bekötés napelemparkokhoz",

  svc5_tag: "Víz-csatorna", svc5_title: "Víz- és csatornahálózatok",
  svc5_i1: "Vízvezetékek felújítása és cseréje",
  svc5_i2: "Öntözőrendszerek bővítése",
  svc5_i3: "Földalatti adatátviteli hálózatok",

  svc6_tag: "Optikai kábel", svc6_title: "Távközlési csatornák",
  svc6_i1: "Földalatti csatornák adatátviteli hálózatokhoz",
  svc6_i2: "Optikai kábel csatornázás kiépítése",

  svc7_tag: "Automatizálás", svc7_title: "Vezérlés és védelem",
  svc7_i1: "Gyengeáramú villamos berendezések",
  svc7_i2: "Relés vezérlési és védelmi berendezések",
  svc7_i3: "Szigetelési ellenállás és folytonosság mérése",

  proj_eyebrow: "Referenciamunkák",
  proj_h2: "Maros megyében megvalósított projektek",
  proj_lede: "Válogatás munkáinkból, földrajzi elhelyezkedés szerint. Vigye a kurzort egy pontra a részletekért.",
  proj_map_full_label_html: "Maros megye — <strong>18 / 150+ projekt</strong>",
  proj_map_updated: "Frissítve 2026",
  proj_footer_note: "Minden munkánk kategóriák szerint is rendszerezve van, a gyorsabb áttekintés érdekében.",
  proj_archive_btn: "Teljes archívum megtekintése →",

  // Current projects section
  current_eyebrow: "Folyamatban lévő munkák",
  current_h2: "Mit csinálunk most",
  current_lede: "Betekintés a jelenleg folyamatban lévő projektekbe, csapatunk által rendszeresen frissítve.",
  current_empty: "Jelenleg nincs megjelenített aktív projekt.",
  current_status_scheduled: "Tervezett",
  current_status_progress: "Folyamatban",
  current_status_done: "Befejezve",
  current_progress_label: "Becsült előrehaladás",
  current_k_start: "Kezdés",
  current_k_due: "Becsült befejezés",
  hub_tag: "Székhely",
  hub_title: "Insta Grup S.A.",
  hub_desc: "Căminului utca 35, Marosvásárhely",

  mp1_tag: "Napelemes", mp1_title: "Agrişteu napelempark", mp1_desc: "20 kV + 0,4 kV LES villamos bekötés a napelemparkhoz.",
  mp2_tag: "Villamos hálózatok", mp2_title: "Marosvásárhelyi ipari zóna", mp2_desc: "Átállás 20 kV-ra — 20 km földalatti villamos vezeték.",
  mp3_tag: "Villamos hálózatok", mp3_title: "Városközpont korszerűsítése", mp3_desc: "Föld feletti villamos vezetékek földalattivá alakítása, Marosvásárhely.",
  mp4_tag: "Víz-csatorna", mp4_title: "Valea Rece vezeték felújítása", mp4_desc: "Ivóvízvezeték cseréje a Valea Rece nyomvonalon.",
  mp5_tag: "Villamos hálózatok", mp5_title: "Sânpaul alállomás", mp5_desc: "Ellátásbiztonság növelése a 110 kV-os alállomáson.",
  mp6_tag: "Áramellátás", mp6_title: "Hirschmann TM1/TM2 üzem", mp6_desc: "Áramellátás és teljesítménynövelés a gyártócsarnokoknak.",
  mp7_tag: "Közvilágítás", mp7_title: "Cristești közvilágítás felújítása", mp7_desc: "Gyalogátkelők és közvilágítás korszerűsítése.",
  mp8_tag: "Optikai kábel", mp8_title: "Marosvásárhelyi csatornázás", mp8_desc: "Földalatti csatornák adatátviteli hálózatokhoz.",
  mp9_tag: "Áramellátás", mp9_title: "Belrom Unu üzletközpont", mp9_desc: "Villamosenergia-ellátás, I. ütem, Marosvásárhely.",
  mp10_tag: "Villamos hálózatok", mp10_title: "110 kV-os Fântânele–Szováta vezeték", mp10_desc: "Szigetelőcsere a nagyfeszültségű vezeték kereszteződéseinél.",
  mp11_tag: "Áramellátás", mp11_title: "Megyei Sürgősségi Kórház", mp11_desc: "Új összekötő utca és a hozzá tartozó áramellátás.",
  mp12_tag: "Villamos hálózatok", mp12_title: "Sânpaul feszültségjavítás", mp12_desc: "Ellátásbiztonság növelése a Sânpaul alállomásról történő betáplálással.",
  mp13_tag: "Közvilágítás", mp13_title: "Gh. Doja utcai közvilágítás", mp13_desc: "Körforgalom és világítás egy bevásárlóközponthoz.",
  mp14_tag: "Áramellátás", mp14_title: "Prolemn Reghin gyártócsarnok", mp14_desc: "Világítási és villámvédelmi berendezések, PAL/MDF üzem.",
  mp15_tag: "Villamos hálózatok", mp15_title: "20 kV-os Râciu–Sărmaş vezeték", mp15_desc: "Szigetelőcsere a középfeszültségű légvezetéken.",
  mp16_tag: "Automatizálás", mp16_title: "Kastamonu Romania raktárak", mp16_desc: "Villámvédelmi berendezés, faraktár és irodai zóna.",
  mp17_tag: "Víz-csatorna", mp17_title: "CASM öntözésbővítés", mp17_desc: "Öntözőrendszer bővítése a CASM területén.",
  mp18_tag: "Optikai kábel", mp18_title: "Vodafone hálózat", mp18_desc: "Optikai kábel csatornázás kiépítése.",

  report_eyebrow: "Közvilágítási hibabejelentés",
  report_h2: "Probléma bejelentése",
  report_lede: "Jelentsen be egy működési hibát vagy baleset/vészhelyzetet a közvilágítási hálózaton. Minden bejelentés nyilvántartási számot kap.",
  report_all_btn: "Összes bejelentés →",
  step1_label: "01 · Bejelentés típusa",
  step2_label: "02 · Részletek",
  type_func_title: "Működési hiba",
  type_func_desc: "Kiégett izzó, sérült oszlop, láthatóan sérült kábel vagy más, nem közvetlen veszélyt jelentő probléma.",
  type_accident_title: "Baleset / vészhelyzet",
  type_accident_desc: "Ledőlt oszlop, szabadon lévő feszültség alatti kábelek vagy bármilyen, a közbiztonságot közvetlenül veszélyeztető helyzet.",
  emergency_title: "Közvetlen veszély? Hívjon most",
  emergency_desc: "Közbiztonságot veszélyeztető vészhelyzet esetén hívjon közvetlenül — ne várja meg az űrlap feldolgozását.",
  f_name_label: "Név",
  f_name_ph: "Az Ön neve",
  f_phone_label: "Telefonszám",
  f_phone_ph: "07xx xxx xxx",
  f_email_label_html: "Email <span class=\"opt\">(opcionális)</span>",
  f_email_ph: "nev@pelda.ro",
  f_address_label: "A probléma helyszíne",
  f_address_ph: "Utca, szám, település",
  f_desc_label: "A probléma leírása",
  f_desc_ph: "Röviden írja le, mit tapasztalt...",
  back_link: "← Vissza",
  submit_btn: "Bejelentés küldése →",
  submit_btn_sending: "Küldés...",
  submit_success_html: "A bejelentést rögzítettük, száma: {num}. Köszönjük!",
  submit_error: "Hiba történt a bejelentés küldésekor. Kérjük, próbálja újra, vagy hívja a 0265 253 997 számot.",
  select_type_error: "Előbb válassza ki a bejelentés típusát.",

  contact_eyebrow: "Kapcsolat",
  contact_h2: "Van egy projektje?",
  contact_lede: "Meséljen a munkáról — 2 munkanapon belül válaszolunk időbecsléssel és árajánlattal.",
  contact_k_sediu: "Székhely",
  contact_v_sediu: "Căminului utca 35, Marosvásárhely, Maros megye",
  contact_k_telefon: "Telefon",
  contact_v_telefon: "+40 265 000 000",
  contact_k_email: "Email",
  contact_v_email: "office@insta-grup.ro",
  contact_k_program: "Nyitvatartás",
  contact_v_program: "Hétfő – Péntek, 08:00 – 16:00",
  cf_name_label: "Név",
  cf_name_ph: "Az Ön neve",
  cf_email_label: "Email",
  cf_email_ph: "nev@ceg.ro",
  cf_message_label: "Projekt részletei",
  cf_message_ph: "Röviden írja le a munkát...",
  cf_submit_btn: "Kérés elküldése",
  cf_submit_sending: "Küldés...",
  cf_success: "Köszönjük! Kérését elküldtük.",
  cf_error: "Hiba történt a küldés során. Kérjük, próbálja újra, vagy hívja a 0265 253 997 számot.",

  footer_copy: "© 2026 Insta Grup S.A. Minden jog fenntartva.",
  footer_gdpr: "Adatvédelmi tájékoztató (GDPR)",
  footer_tc: "Általános Szerződési Feltételek",
  footer_location: "Marosvásárhely, Románia",
  legal_ro_only_note: "Ez a dokumentum hivatalosan csak román nyelven érhető el.",

  ticket_type_func: "Működési hiba",
  ticket_type_accident: "Baleset",
  ticket_status_active: "Aktív",
  ticket_status_done: "Megoldva",

  archive_eyebrow: "Teljes archívum",
  archive_h1: "Minden Maros megyében megvalósított projekt",
  archive_lede: "Több mint 25 év tevékenység — a befejezett munkák teljes listája, 1997-től napjainkig. Szűrjön kategória szerint, vagy keressen egy adott projektet.",
  archive_back: "← Vissza a referenciamunkákhoz",
  archive_search_ph: "Projekt keresése (pl. Sânpaul, LEA, optikai kábel)...",
  archive_search_aria: "Projekt keresése",
  archive_cat_all: "Összes",
  archive_cat_retele: "Villamos hálózatok",
  archive_cat_alimentari: "Áramellátás",
  archive_cat_iluminat: "Közvilágítás",
  archive_cat_apa: "Víz-csatorna",
  archive_cat_fibra: "Optikai kábel",
  archive_cat_foto: "Napelemes",
  archive_cat_automat: "Automatizálás",
  archive_count_of: "{n} / {total} projekt megjelenítve",
  archive_no_results: "Nem található projekt. Próbáljon más keresési kifejezést.",
  archive_data_note: "Az alábbi projektleírások eredeti történelmi feljegyzésként román nyelven maradtak.",

  public_eyebrow: "Közvilágítási bejelentések",
  public_h1: "A bejelentések jelenlegi állapota",
  public_lede: "A weboldalon keresztül beküldött közvilágítási bejelentések nyilvános listája — átláthatóság céljából, a bejelentők személyes adatai nélkül.",
  public_back: "← Új probléma bejelentése",
  public_search_ph: "Keresés cím vagy bejelentési szám alapján...",
  public_search_aria: "Bejelentés keresése",
  public_chip_active: "Aktív",
  public_chip_done: "Megoldva",
  public_count: "{n} bejelentés",
  public_no_results: "Nincs bejelentés ebben a kategóriában.",
  public_load_error: "Hiba történt a bejelentések betöltésekor. Kérjük, próbálja újra.",
  public_k_date: "Bejelentés dátuma",
  public_k_address: "Cím",
  public_k_desc: "A probléma leírása",
  public_k_resolved: "Megoldás dátuma",
  public_k_work_done: "Elvégzett munka",
  public_before: "Előtte",
  public_after: "Utána",
},

};

function getLang(){
  return localStorage.getItem('lang') || 'ro';
}

function t(key, vars){
  const lang = getLang();
  let str = (I18N[lang] && I18N[lang][key]) || (I18N.ro && I18N.ro[key]) || key;
  if (vars) {
    Object.keys(vars).forEach(k => { str = str.replace(`{${k}}`, vars[k]); });
  }
  return str;
}

function applyTranslations(){
  const lang = getLang();
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  document.querySelectorAll('.lang-switch button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-lang') === lang);
  });

  window.dispatchEvent(new CustomEvent('langchange'));
}

function setLanguage(lang){
  localStorage.setItem('lang', lang);
  applyTranslations();
}

document.addEventListener('DOMContentLoaded', applyTranslations);
