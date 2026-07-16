'use strict';

// ── Vaccine database ────────────────────────────────────────────
const VACCINES = [
  {
    name: 'BCG',
    route: 'ID',
    factor: 'STAT',
    schedule: [0],
    remark: '0.1 ml ไหล่ซ้าย ไม่ควรฉีดที่สะโพก',
    remarkExtra: null,
    available: null,
  },
  {
    name: 'Dengvaxia Vaccine (0.5 mL)',
    route: null,
    factor: 'month',
    schedule: [0, 6, 12],
    remark: 'Dengvaxia 6–45 yrs และเคยติดเชื้อมาก่อน\nไม่แนะนำในผู้ที่ไม่เคยติดเชื้อมาก่อน',
    remarkExtra: null,
    available: 'Dengvaxia Vaccine (0.5 mL)',
  },
  {
    name: 'dT (Diphtheria/Tetanus)',
    route: 'IM',
    factor: 'month',
    schedule: [0, 1, 7],
    remark: 'สำหรับเด็กอายุตั้งแต่ 7 ปีขึ้นไป\nใช้เป็น Dose กระตุ้น ในกรณีผู้ที่เคยได้รับวัคซีนครบ Course แล้ว\nควรฉีดกระตุ้นทุกๆ 10 ปี',
    remarkExtra: null,
    available: 'Diphtheria/Tetanus VAC(dT, Single Adult) (0.5 mL)',
  },
  {
    name: 'DTP (Boostrix)',
    route: null,
    factor: 'STAT',
    schedule: [0],
    remark: 'Boostrix, Boostagen',
    remarkExtra: null,
    available: 'Boostrix Pfs Vaccine (0.5 Ml)',
  },
  {
    name: 'Hep A+B (Twinrix)',
    route: null,
    factor: 'month',
    schedule: [0, 1, 6],
    remark: 'Twinrix Vaccine',
    remarkExtra: null,
    available: 'Twinrix Vaccine',
  },
  {
    name: 'Hepatitis-A',
    route: null,
    factor: 'month',
    schedule: [0, 6],
    remark: 'เข็มที่ 2: 0, 6–18 เดือน\n1–15 ปี → Avaxim 80 U Pediatric\n16 ปีขึ้นไป → Avaxim 160 U\n1–18 ปี → Vaqta (0.5 ml); 19 ปีขึ้นไป → Vaqta (1 ml)\nกรณีต้องการฉีดกระตุ้นด้วย VAQTA สามารถฉีดหลังได้ HAVRIX ไปแล้ว 6–12 เดือน',
    remarkExtra: null,
    available: 'Avaxim 80 U Pediatric / Avaxim 160 U / Vaqta (Hepatitis A) VACCINE',
  },
  {
    name: 'Hepatitis-B',
    route: null,
    factor: 'month',
    schedule: [0, 1, 6],
    remark: 'Engerix-B, Euvax — 3 เข็ม: 0, 1–2, 6 เดือน\n16 ปีขึ้นไป ฉีด 1 ml\nฉีดกระตุ้นทุก 5 ปี',
    remarkExtra: null,
    available: 'Euvax-B (1 Ml) / Euvax-B (Ped) 0.5 Ml / Engerix-B (0.5 Ml) / Engerix-B (1 Ml)',
  },
  {
    name: 'HPV Vaccine (Gardasil)',
    route: null,
    factor: 'month',
    schedule: [0, 2, 6],
    remark: 'Gardasil\n>15 years: เข็ม 0, 1–2, 6 เดือน\n<15 years: เข็ม 0, 6–12 เดือน\nหากมีการเลื่อนนัด dose 3 ต้องห่างจาก dose 2 อย่างน้อย 4 เดือน',
    remarkExtra: null,
    available: 'Gardasil 0.5 Ml / Cervarix 0.5 Ml',
  },
  {
    name: 'Influenza',
    route: null,
    factor: 'STAT',
    schedule: [0],
    remark: 'Vaxigrip, Influvac — ฉีดปีละ 1 ครั้ง\n>3 ปี ฉีด 0.5 ml',
    remarkExtra: null,
    available: 'Fluquadri VACCINE (0.5 mL) / Fluquadri VACCINE Ped (0.25 mL)',
  },
  {
    name: 'Live JE (Imojev)',
    route: 'ID',
    factor: 'month',
    schedule: [0, 12],
    remark: 'Imojev 9 เดือนขึ้นไป ฉีด 2 เข็ม\nเข็มแรกที่อายุ 9–12 เดือน เข็มต่อมาห่างจากเข็มแรก 1–2 ปี\nในผู้ใหญ่ ไม่จำเป็นต้องฉีดกระตุ้นภายใน 5 ปี หลังฉีด Imojev เข็มแรก',
    remarkExtra: null,
    available: 'Imojev Vaccine (0.5 Ml)',
  },
  {
    name: 'Meningococcal (Menactra)',
    route: 'IM',
    factor: 'month',
    schedule: [0, 3],
    remark: 'Menactra — Meningococcal ACWY conjugate vaccine\nอายุ 9–23 เดือน: 2 เข็ม ห่างกัน 3 เดือน\nอายุ 2–55 ปี: 1 เข็ม\nกลุ่มเสี่ยงบางรายอาจต้อง booster ตามแนวทาง',
    remarkExtra: null,
    available: 'Menactra Vaccine (0.5 Ml) Vial',
  },
  {
    name: 'MMR (Priorix)',
    route: 'SC',
    factor: 'month',
    schedule: [0, 1, 9],
    remark: 'ฉีด 2 ครั้ง เข็มแรกเมื่ออายุ 9–12 เดือน เข็มที่ 2 เมื่ออายุ 18 เดือน\nในผู้ใหญ่ เข็ม 2 ห่างจากเข็มแรก 1 เดือน (ถ้ามีการระบาด/สัมผัสโรค/อยากฉีดให้ครบโดยเร็ว)',
    remarkExtra: null,
    available: 'Priorix PRTC 0.5 mL (MMR)',
  },
  {
    name: 'Pneumococcal (Synflorix/Prevnar)',
    route: 'IM',
    factor: 'month',
    schedule: [0, 2, 4],
    remark: 'Synflorix ฉีด 6 สัปดาห์–5 ปี\nPrevnar13 ฉีด 6 สัปดาห์ขึ้นไป\nให้ 3 ครั้ง ที่อายุ 2, 4, 6 เดือน (ห่างเข็มละ 2 เดือน)\nฉีดกระตุ้นที่อายุ 12–15 เดือน (ห่างเข็มสุดท้ายอย่างน้อย 2 เดือน)',
    remarkExtra: null,
    available: 'Synflorix Vaccine (0.5 Ml) / Prevnar 13 Vaccine (0.5 Ml)',
  },
  {
    name: 'Qdenga (Dengue)',
    route: null,
    factor: 'month',
    schedule: [0, 3],
    remark: 'Qdenga Dengue tetravalent vaccine (live, attenuated)\nTwo-dose schedule: 0 and 3 months',
    remarkExtra: null,
    available: 'Dengue tetravalent vaccine (live, attenuated)',
  },
  {
    name: 'Rabies ID',
    route: 'ID',
    factor: 'day',
    schedule: [0, 3, 7, 30],
    remark: 'Speeda, Verorab\nหลังสัมผัสโรค (ไม่เคยได้รับวัคซีน): ID 4 dose\nก่อนสัมผัสโรค: ID 2 dose (0, 7)',
    remarkExtra: null,
    available: 'Speeda',
  },
  {
    name: 'Rabies IM',
    route: 'IM',
    factor: 'day',
    schedule: [0, 3, 7, 14, 30],
    remark: 'Speeda, Verorab\nหลังสัมผัสโรค (ไม่เคยได้รับวัคซีน): IM 5 dose\nก่อนสัมผัสโรค: IM 2 dose (0, 7 หรือ 0, 21)',
    remarkExtra: null,
    available: 'Speeda',
  },
  {
    name: 'Rotavirus (Rotarix/Rotateq)',
    route: 'Oral',
    factor: 'month',
    schedule: [0, 2, 4],
    remark: 'Rotarix (human monovalent): 2 ครั้ง เมื่ออายุ 2, 4 เดือน\nRotaTeq/Rotasil (pentavalent): 3 ครั้ง เมื่ออายุ 2, 4, 6 เดือน\nเริ่มให้ครั้งแรกได้เมื่ออายุ 6–15 สัปดาห์ และครั้งสุดท้ายอายุไม่เกิน 8 เดือน',
    remarkExtra: 'การให้แต่ละครั้งห่างกันไม่น้อยกว่า 4 สัปดาห์',
    available: 'Rotarix (oral suspension) vaccine (1.5 ml.) / Rotateq vaccine (2 ml.)',
  },
  {
    name: 'TT (Tetanus Toxoid)',
    route: null,
    factor: 'month',
    schedule: [0, 1, 7],
    remark: 'Bio-TT',
    remarkExtra: null,
    available: 'Bio-TT',
  },
  {
    name: 'Typhoid (Typhim)',
    route: 'IM',
    factor: 'STAT',
    schedule: [0],
    remark: 'Typhim IM/SC Single dose\nตั้งแต่ 2 ปีขึ้นไป\nฉีดกระตุ้นทุก 3 ปี ถ้ายังมีโอกาสสัมผัสเชื้อ',
    remarkExtra: null,
    available: 'Typhim',
  },
  {
    name: 'Varicella (Varivax)',
    route: 'SC',
    factor: 'month',
    schedule: [0, 1],
    remark: 'Varivax SC — ฉีดทั้งหมด 2 เข็ม\nเด็กอายุ 1–12 ปี: Dose แรกอายุ 12–18 เดือน, Dose ที่ 2 อายุ 4–6 ปี\nอายุ 13 ปีขึ้นไป: 2 เข็ม ห่างกันอย่างน้อย 1 เดือน',
    remarkExtra: null,
    available: 'Varivax vaccine (0.5 ml.) vial',
  },
  {
    name: 'Gardasil 9',
    route: null,
    factor: 'month',
    schedule: [0, 2, 6],
    remark: 'Gardasil 9 — HPV 9-valent\n>15 years: เข็ม 0, 1–2, 6 เดือน\n<15 years: เข็ม 0, 6–12 เดือน',
    remarkExtra: null,
    available: null,
  },
  {
    name: 'RSV Vaccine (Arexvy)',
    route: 'IM',
    factor: 'STAT',
    schedule: [0],
    remark: 'Arexvy — Respiratory Syncytial Virus Vaccine, Adjuvanted\nSingle dose 0.5 mL IM หลัง reconstitution\nใช้ป้องกัน RSV lower respiratory tract disease ในผู้ใหญ่สูงอายุ/กลุ่มเสี่ยงตามข้อบ่งใช้',
    remarkExtra: 'ไม่ใช่ live vaccine; ไม่ใช้ในหญิงตั้งครรภ์ตามเอกสารกำกับยา',
    available: 'Arexvy RSV Vaccine',
  },
  {
    name: 'RSV Vaccine (Abrysvo)',
    route: 'IM',
    factor: 'STAT',
    schedule: [0],
    remark: 'Abrysvo — Respiratory Syncytial Virus Vaccine\nSingle dose 0.5 mL IM หลัง reconstitution\nใช้ในหญิงตั้งครรภ์ 32–36 สัปดาห์เพื่อป้องกัน RSV LRTD ในทารกแรกเกิด–6 เดือน และใช้ในผู้ใหญ่ตามข้อบ่งใช้',
    remarkExtra: 'ระวัง potential risk of preterm birth: ใช้ใน pregnancy ตามช่วงอายุครรภ์ที่ระบุเท่านั้น; มี warning เรื่อง Guillain-Barré syndrome',
    available: 'Abrysvo RSV Vaccine',
  },
  {
    name: 'Meningococcal B (Bexsero)',
    route: 'IM',
    factor: 'month',
    schedule: [0, 1],
    remark: 'Bexsero — Meningococcal group B vaccine (recombinant, adsorbed)\nขนาด 0.5 mL IM\nทั่วไปในวัยรุ่น/ผู้ใหญ่ใช้ 2 เข็ม ห่างกันอย่างน้อย 1 เดือน; ทารก/เด็กเล็กมี schedule หลายแบบตามอายุเริ่มฉีด',
    remarkExtra: 'ผู้มี asplenia, complement deficiency หรือได้รับ complement inhibitor ยังมีความเสี่ยงต่อโรคแม้ได้รับวัคซีน; พิจารณา paracetamol prophylaxis ในทารกตามเอกสารกำกับยา/แนวทางท้องถิ่น',
    available: 'Bexsero Vaccine (0.5 mL)',
  },
  {
    name: 'Meningococcal ACWY (MenQuadfi)',
    route: 'IM',
    factor: 'STAT',
    schedule: [0],
    remark: 'MenQuadfi — Meningococcal Groups A, C, W, Y conjugate vaccine\nSingle dose 0.5 mL IM สำหรับอายุ 2 ปีขึ้นไป; เด็กเล็กมี schedule ตามอายุเริ่มฉีด\nBooster ในผู้มีความเสี่ยงต่อเนื่องตามเกณฑ์เวลา/แนวทาง',
    remarkExtra: 'ห้ามในผู้แพ้รุนแรงต่อส่วนประกอบ/เข็มก่อนหน้า/วัคซีนที่มี tetanus toxoid; ภูมิคุ้มกันบกพร่องอาจตอบสนองลดลง',
    available: 'MenQuadfi Vaccine (0.5 mL)',
  },
 ];

// ── Clinical metadata ───────────────────────────────────────────
// Notes are intentionally concise for quick front-desk/pharmacy use.
// Always follow current local hospital policy and product leaflet if different.
const CLINICAL_META = {
  'BCG': {
    type: 'live', route: 'ID', ageRange: 'แรกเกิด / neonate; catch-up ตามนโยบายพื้นที่',
    precaution: 'หลีกเลี่ยงใน severe immunodeficiency; ตรวจตำแหน่งฉีดและไม่ควรฉีดสะโพก',
  },
  'Dengvaxia Vaccine (0.5 mL)': {
    type: 'live', route: 'SC', ageRange: '6–45 ปี และมีหลักฐานเคยติดเชื้อ dengue มาก่อน',
    precaution: 'ไม่แนะนำในผู้ไม่เคยติดเชื้อ dengue; หลีกเลี่ยงในตั้งครรภ์/ภูมิคุ้มกันบกพร่อง',
  },
  'dT (Diphtheria/Tetanus)': {
    type: 'inactive', route: 'IM', ageRange: '≥7 ปี; booster ทุก 10 ปีตามข้อบ่งใช้',
    precaution: 'เลื่อนฉีดหากมี acute moderate/severe illness; ระวังประวัติ anaphylaxis ต่อส่วนประกอบ',
  },
  'DTP (Boostrix)': {
    type: 'inactive', route: 'IM', ageRange: 'เด็กโต/วัยรุ่น/ผู้ใหญ่ ตามข้อบ่งใช้ของ Tdap',
    precaution: 'ระวังประวัติ encephalopathy หลัง pertussis vaccine หรือ anaphylaxis ต่อส่วนประกอบ',
  },
  'Hep A+B (Twinrix)': {
    type: 'inactive', route: 'IM', ageRange: 'โดยทั่วไป ≥1 ปี; ใช้สูตร adult/pediatric ตามผลิตภัณฑ์',
    precaution: 'ห้ามฉีดในผู้แพ้รุนแรงต่อ dose ก่อนหน้า/ส่วนประกอบ; ตรวจประวัติภูมิคุ้มกันตามเหมาะสม',
  },
  'Hepatitis-A': {
    type: 'inactive', route: 'IM', ageRange: '≥1 ปี; เลือก pediatric/adult formulation ตามอายุ',
    precaution: 'ห้ามฉีดในผู้แพ้รุนแรงต่อ dose ก่อนหน้า/ส่วนประกอบ; acute illness ควรเลื่อน',
  },
  'Hepatitis-B': {
    type: 'inactive', route: 'IM', ageRange: 'แรกเกิด–ผู้ใหญ่; dose ตามอายุ/ผลิตภัณฑ์',
    precaution: 'ระวังประวัติแพ้ยีสต์/ส่วนประกอบ; พิจารณาตรวจ serology ในกลุ่มเสี่ยง/บุคลากร',
  },
  'HPV Vaccine (Gardasil)': {
    type: 'inactive', route: 'IM', ageRange: 'โดยทั่วไป 9–45 ปี; จำนวนเข็มขึ้นกับอายุเริ่มฉีด',
    precaution: 'ไม่ใช่ live vaccine; เลื่อนในตั้งครรภ์โดยทั่วไป และเฝ้าระวัง syncope หลังฉีด',
  },
  'Influenza': {
    type: 'inactive', route: 'IM', ageRange: '≥6 เดือน; ฉีดปีละครั้ง',
    precaution: 'เลือก formulation ให้เหมาะกับอายุ; ระวังประวัติ anaphylaxis ต่อส่วนประกอบ',
  },
  'Live JE (Imojev)': {
    type: 'live', route: 'SC', ageRange: 'โดยทั่วไป ≥9 เดือน; schedule ตามพื้นที่/ผลิตภัณฑ์',
    precaution: 'Live attenuated: หลีกเลี่ยงในตั้งครรภ์/ภูมิคุ้มกันบกพร่อง; เว้นห่าง live injectable อื่น 4 สัปดาห์ถ้าไม่ได้ฉีดวันเดียวกัน',
  },
  'Meningococcal (Menactra)': {
    type: 'inactive', route: 'IM', ageRange: '9 เดือน–55 ปี ตามผลิตภัณฑ์; กลุ่มเสี่ยงอาจต้อง booster',
    precaution: 'ระวัง anaphylaxis ต่อส่วนประกอบ; ประเมินความเสี่ยง asplenia/complement deficiency/เดินทาง',
  },
  'MMR (Priorix)': {
    type: 'live', route: 'SC', ageRange: 'เด็ก ≥9–12 เดือน; ผู้ใหญ่ที่ไม่มีภูมิ/มีข้อบ่งใช้',
    precaution: 'ห้ามในตั้งครรภ์/ภูมิคุ้มกันบกพร่องรุนแรง; หลีกเลี่ยงตั้งครรภ์ 4 สัปดาห์หลังฉีด; เว้น live injectable อื่น 4 สัปดาห์ถ้าไม่ได้ฉีดวันเดียวกัน',
  },
  'Pneumococcal (Synflorix/Prevnar)': {
    type: 'inactive', route: 'IM', ageRange: 'เด็กเล็กตั้งแต่ 6 สัปดาห์ขึ้นไป; ผู้ใหญ่/กลุ่มเสี่ยงตามชนิด PCV/PPSV',
    precaution: 'เลือกสูตรตามอายุและประวัติได้รับวัคซีนเดิม; ระวัง anaphylaxis ต่อส่วนประกอบ',
  },
  'Qdenga (Dengue)': {
    type: 'live', route: 'SC', ageRange: '4–60 ปี ตามเอกสารกำกับยา; 2 เข็มห่าง 3 เดือน',
    precaution: 'Live attenuated: ห้ามในตั้งครรภ์/ให้นมบุตร/ภูมิคุ้มกันบกพร่อง; หลีกเลี่ยงตั้งครรภ์ 1 เดือนหลังฉีด',
  },
  'Rabies ID': {
    type: 'inactive', route: 'ID', ageRange: 'ทุกวัยเมื่อมีข้อบ่งใช้ pre/post-exposure',
    precaution: 'หลังสัมผัสโรคอย่าล่าช้า; ประเมิน RIG และ wound care; schedule ขึ้นกับประวัติวัคซีนเดิม',
  },
  'Rabies IM': {
    type: 'inactive', route: 'IM', ageRange: 'ทุกวัยเมื่อมีข้อบ่งใช้ pre/post-exposure',
    precaution: 'หลังสัมผัสโรคอย่าล่าช้า; ประเมิน RIG และ wound care; schedule ขึ้นกับประวัติวัคซีนเดิม',
  },
  'Rotavirus (Rotarix/Rotateq)': {
    type: 'live', route: 'Oral', ageRange: 'ทารก; เริ่ม dose แรกช่วง 6–15 สัปดาห์ และจบก่อน 8 เดือน',
    precaution: 'ห้ามฉีดเข้ากล้าม/หลอดเลือด; หลีกเลี่ยงใน SCID และระวังประวัติ intussusception',
  },
  'TT (Tetanus Toxoid)': {
    type: 'inactive', route: 'IM', ageRange: 'เด็กโต/ผู้ใหญ่/หญิงตั้งครรภ์ตามข้อบ่งใช้',
    precaution: 'ใช้เป็น tetanus prophylaxis/booster ตามประวัติวัคซีนและชนิดแผล; ระวัง anaphylaxis ต่อส่วนประกอบ',
  },
  'Typhoid (Typhim)': {
    type: 'inactive', route: 'IM', ageRange: '≥2 ปี; booster ทุก 3 ปีหากยังเสี่ยง',
    precaution: 'ไม่ป้องกันได้ 100%; ยังต้องเน้นอาหาร/น้ำสะอาด; ระวัง anaphylaxis ต่อส่วนประกอบ',
  },
  'Varicella (Varivax)': {
    type: 'live', route: 'SC', ageRange: '≥12 เดือน; อายุ ≥13 ปีให้ 2 เข็มห่างอย่างน้อย 4 สัปดาห์',
    precaution: 'ห้ามในตั้งครรภ์/ภูมิคุ้มกันบกพร่องรุนแรง; หลีกเลี่ยงตั้งครรภ์ 4 สัปดาห์หลังฉีด; เลี่ยง aspirin ในเด็กหลังฉีดตามคำแนะนำผลิตภัณฑ์',
  },
  'Gardasil 9': {
    type: 'inactive', route: 'IM', ageRange: 'โดยทั่วไป 9–45 ปี; จำนวนเข็มขึ้นกับอายุเริ่มฉีด',
    precaution: 'เลื่อนในตั้งครรภ์โดยทั่วไป; เฝ้าระวัง syncope หลังฉีด',
  },
  'RSV Vaccine (Arexvy)': {
    type: 'inactive', route: 'IM', ageRange: '≥60 ปี; และ 18–59 ปีที่มีความเสี่ยงต่อ RSV LRTD ตามข้อบ่งใช้',
    precaution: 'ไม่ใช้ในหญิงตั้งครรภ์; ระวังประวัติแพ้รุนแรง และ warning เรื่อง Guillain-Barré syndrome ภายใน 42 วันหลังฉีด',
  },
  'RSV Vaccine (Abrysvo)': {
    type: 'inactive', route: 'IM', ageRange: 'หญิงตั้งครรภ์ 32–36 สัปดาห์; ≥60 ปี; และ 18–59 ปีที่มีความเสี่ยงต่อ RSV LRTD ตามข้อบ่งใช้',
    precaution: 'ให้ใน pregnancy เฉพาะช่วง 32–36 สัปดาห์เพื่อลด potential risk of preterm birth; ระวัง Guillain-Barré syndrome และ anaphylaxis',
  },
  'Meningococcal B (Bexsero)': {
    type: 'inactive', route: 'IM', ageRange: 'ตั้งแต่อายุ ≥2 เดือนขึ้นไป; schedule ขึ้นกับอายุเมื่อเริ่มฉีด',
    precaution: 'ระวัง anaphylaxis; กลุ่ม asplenia/complement deficiency/complement inhibitor ยังเสี่ยงต่อ invasive meningococcal disease แม้ฉีดแล้ว',
  },
  'Meningococcal ACWY (MenQuadfi)': {
    type: 'inactive', route: 'IM', ageRange: 'ตั้งแต่อายุ 6 สัปดาห์ขึ้นไปตามเอกสารล่าสุด; อายุ 2 ปีขึ้นไปมักเป็น single dose',
    precaution: 'ห้ามในผู้แพ้รุนแรงต่อส่วนประกอบ/เข็มก่อนหน้า/วัคซีนที่มี tetanus toxoid; altered immunocompetence อาจตอบสนองลดลง; ระวัง syncope',
  },
};

function metaFor(vac) {
  const meta = CLINICAL_META[vac.name] || {};
  return {
    type: meta.type || (LIVE_VACCINE_NAMES.includes(vac.name) ? 'live' : 'inactive'),
    route: meta.route || vac.route || 'IM',
    ageRange: meta.ageRange || 'ตรวจตามเอกสารกำกับยา/แนวทางหน่วยงาน',
    precaution: meta.precaution || 'ตรวจประวัติแพ้รุนแรงต่อวัคซีนหรือส่วนประกอบ และเลื่อนหากมี acute moderate/severe illness',
  };
}

// ── Thai children schedule matrix (adapted from provided Thai 2569 reference images) ──
const THAI_GOV_AGES = ['แรกเกิด', '1 เดือน', '2 เดือน', '4 เดือน', '6 เดือน', '9-12 เดือน', '18 เดือน', '2-2½ ปี', '4-6 ปี', '11-12 ปี'];
const THAI_GOV_VACCINES = [
  'BCG', 'HB', 'DTwP-HB-Hib', 'Polio', 'Rota', 'MMR', 'Live JE', 'Influenza', 'HPV'
];
const THAI_GOV_CELLS = {
  'แรกเกิด':     { 'BCG': 'BCG', 'HB': 'HB1' },
  '1 เดือน':      { 'HB': '(HB2)' },
  '2 เดือน':      { 'DTwP-HB-Hib': 'Dose 1', 'Polio': 'IPV1', 'Rota': 'Rota1' },
  '4 เดือน':      { 'DTwP-HB-Hib': 'Dose 2', 'Polio': 'IPV2', 'Rota': 'Rota2' },
  '6 เดือน':      { 'DTwP-HB-Hib': 'Dose 3', 'Polio': 'OPV1', 'Rota': '(Rota3)', 'Influenza': 'เริ่ม yearly' },
  '9-12 เดือน':   { 'MMR': 'MMR1', 'Live JE': 'JE1', 'Influenza': 'ทุกปี' },
  '18 เดือน':     { 'DTwP-HB-Hib': 'Booster 1', 'Polio': 'OPV B1', 'MMR': 'MMR2', 'Influenza': 'ทุกปี' },
  '2-2½ ปี':      { 'Live JE': 'JE2', 'Influenza': 'ทุกปี' },
  '4-6 ปี':       { 'DTwP-HB-Hib': 'Booster 2', 'Polio': 'OPV B2', 'Influenza': 'ทุกปี' },
  '11-12 ปี':     { 'DTwP-HB-Hib': 'Td/Tdap', 'HPV': 'โครงการ/2 doses', 'Influenza': 'ทุกปี' },
};

const THAI_OPTIONAL_AGES = ['แรกเกิด', '2 เดือน', '4 เดือน', '6 เดือน', '12-15 เดือน', '18 เดือน', '2-2½ ปี', '4 ปี', '6 ปี', '9 ปี', '11-12 ปี', '18 ปี'];
const THAI_OPTIONAL_VACCINES = [
  'DTaP/Tdap-IPV-Hib', 'PCV', 'Inactivated JE', 'EV71', 'HAV', 'VZV/MMRV', 'Influenza', 'HPV', 'Dengue', 'Rabies', 'MenB', 'COVID-19', 'RSV'
];
const THAI_OPTIONAL_CELLS = {
  'แรกเกิด':    {},
  '2 เดือน':    { 'DTaP/Tdap-IPV-Hib': 'Dose 1', 'PCV': 'PCV1', 'MenB': 'MenB1' },
  '4 เดือน':    { 'DTaP/Tdap-IPV-Hib': 'Dose 2', 'PCV': 'PCV2', 'MenB': 'MenB2' },
  '6 เดือน':    { 'DTaP/Tdap-IPV-Hib': 'Dose 3', 'PCV': '(PCV3)', 'Inactivated JE': 'JE1/JE2', 'EV71': 'Dose 1-2', 'Influenza': 'เริ่ม yearly' },
  '12-15 เดือน':{ 'PCV': 'PCV4', 'VZV/MMRV': 'VZV1 / MMRV1' },
  '18 เดือน':   { 'DTaP/Tdap-IPV-Hib': 'Booster 1', 'Inactivated JE': 'JE3', 'VZV/MMRV': 'VZV2 / MMRV2' },
  '2-2½ ปี':    { 'HAV': '2 doses / 6-12 mo apart', 'Influenza': 'ทุกปี', 'Rabies': 'Pre-exposure' },
  '4 ปี':       { 'DTaP/Tdap-IPV-Hib': 'Booster 2' },
  '6 ปี':       { 'Influenza': 'ทุกปี', 'COVID-19': 'ตามคำแนะนำ' },
  '9 ปี':       { 'HPV': 'เริ่มได้', 'Dengue': '2 doses / 3 mo apart', 'Influenza': 'ทุกปี' },
  '11-12 ปี':   { 'DTaP/Tdap-IPV-Hib': 'Tdap', 'HPV': '2-dose series', 'Influenza': 'ทุกปี', 'COVID-19': 'ตามคำแนะนำ' },
  '18 ปี':      { 'DTaP/Tdap-IPV-Hib': 'Td/Tdap booster', 'COVID-19': 'ตามคำแนะนำ', 'RSV': 'เฉพาะข้อบ่งใช้' },
};

const THAI_SCHEDULE_NOTES = [
  'ตารางนี้จัดทำเป็นมุมมองอ่านง่ายจากภาพอ้างอิงที่ผู้ใช้อัปโหลด จึงสรุปเฉพาะรายการสำคัญ',
  'Government recommended = วัคซีนพื้นฐานสำหรับเด็กไทยตามแผนหลัก',
  'Optional vaccines = วัคซีนเสริม/วัคซีนทางเลือกที่อาจพิจารณาเพิ่มเติมตามความเหมาะสม',
  'ควรตรวจสอบตารางล่าสุดของหน่วยงานทางการและเอกสารกำกับยาอีกครั้งก่อนใช้งานจริง',
];


const THAI_VACCINE_DETAILS = {
  'BCG': {
    title: 'วัคซีนบีซีจี (BCG)',
    disease: 'ป้องกันวัณโรค โดยเฉพาะวัณโรครุนแรงในเด็กเล็ก เช่น วัณโรคเยื่อหุ้มสมองและวัณโรคแพร่กระจาย',
    recommendation: 'ฉีดเมื่อแรกเกิด ภายใน 7 วันหลังคลอดหรือก่อนออกจากโรงพยาบาล หากไม่มีหลักฐานว่าเคยได้รับวัคซีนและไม่มีแผลเป็น สามารถฉีดได้ทุกอายุ',
    sideEffect: 'ประมาณ 2–3 สัปดาห์หลังฉีดอาจมีตุ่มแดงหรือฝีเล็ก ๆ ที่ตำแหน่งฉีด และแห้งหายได้เอง',
    caution: 'ไม่แนะนำในผู้มีภูมิคุ้มกันบกพร่อง ผู้ได้รับยากดภูมิ หญิงตั้งครรภ์ ผู้เจ็บป่วยเฉียบพลัน หรือมีแผลติดเชื้อ/แผลไฟไหม้บริเวณที่จะฉีด',
    page: 'หน้า 10',
  },
  'HB': {
    title: 'วัคซีนไวรัสตับอักเสบบี (Hepatitis B)',
    disease: 'ป้องกันไวรัสตับอักเสบบี ซึ่งติดต่อผ่านเลือด สารคัดหลั่ง เพศสัมพันธ์ ของมีคม และจากมารดาสู่ทารก เสี่ยงตับอักเสบเรื้อรัง ตับแข็ง และมะเร็งตับ',
    recommendation: 'เด็กทุกคนควรได้รับอย่างน้อย 4 เข็ม เริ่มตั้งแต่แรกเกิด และเข็มสุดท้ายที่อายุ 6 เดือน หากมารดาเป็นพาหะควรให้วัคซีนภายใน 12 ชั่วโมงหลังคลอดร่วมกับ HBIG และเพิ่มเข็มที่อายุ 1 เดือน',
    sideEffect: 'ปวด บวม แดงบริเวณที่ฉีด หรือมีไข้ต่ำ ๆ โดยมักไม่รุนแรงและหายภายใน 24 ชั่วโมง',
    caution: 'ไม่แนะนำในผู้แพ้ยีสต์รุนแรง หรือมีประวัติแพ้วัคซีนชนิดรุนแรง',
    page: 'หน้า 11',
  },
  'DTwP-HB-Hib': {
    title: 'วัคซีนรวมคอตีบ-บาดทะยัก-ไอกรน-ตับอักเสบบี-ฮิบ',
    disease: 'ป้องกันคอตีบ บาดทะยัก ไอกรน ตับอักเสบบี และโรคติดเชื้อ Hib โดยวัคซีนกลุ่มคอตีบ/บาดทะยัก/ไอกรนมีทั้งสูตรรวมหลายชนิด',
    recommendation: 'สำหรับเด็กให้วัคซีนรวม 5 โรคหรือ 6 โรคที่อายุ 2, 4, 6 เดือน กระตุ้นที่ 1 ปี 6 เดือน และ 4–6 ปี; วัยรุ่นและผู้ใหญ่ควรกระตุ้น Td/Tdap ตามเกณฑ์',
    sideEffect: 'อาจปวด บวม แดงบริเวณที่ฉีด มีไข้ และร้องกวน อาการมักไม่รุนแรงและหายภายใน 2 วัน',
    caution: 'ไม่ควรรับวัคซีนที่มีไอกรนหากเคยชัก/ไม่รู้สึกตัวโดยไม่มีสาเหตุภายใน 7 วันหลังเข็มก่อน หรือมีประวัติแพ้รุนแรง/โรคทางสมองที่ควบคุมไม่ได้',
    page: 'หน้า 12–13',
  },
  'Polio': {
    title: 'วัคซีนโปลิโอ (IPV/OPV)',
    disease: 'ป้องกันโรคโปลิโอ ซึ่งติดต่อทางอาหารหรือน้ำปนเปื้อน อาจทำให้แขนขาอัมพาตเฉียบพลัน กล้ามเนื้อลีบ และระบบหายใจล้มเหลว',
    recommendation: 'ตามตารางพื้นฐาน: IPV ที่ 2 และ 4 เดือน; OPV ที่ 6 เดือน, 1 ปี 6 เดือน และ 4 ปี สามารถใช้ IPV แทน OPV ได้ตามความเหมาะสม',
    sideEffect: 'วัคซีนโปลิโอมีผลข้างเคียงน้อยมาก',
    caution: 'ไม่ควรให้ OPV ในผู้มีภูมิคุ้มกันบกพร่อง ผู้ที่อยู่ร่วมบ้านกับผู้มีภูมิคุ้มกันบกพร่อง และหญิงตั้งครรภ์; IPV หลีกเลี่ยงในผู้แพ้รุนแรงต่อวัคซีนหรือยาปฏิชีวนะบางชนิด',
    page: 'หน้า 14',
  },
  'Rota': {
    title: 'วัคซีนโรต้า (Rotavirus)',
    disease: 'ป้องกันโรคอุจจาระร่วงจาก rotavirus ซึ่งพบมากในทารกและเด็กเล็ก',
    recommendation: 'ให้ในช่วงทารกตามชนิดวัคซีน เช่น 2 และ 4 เดือน หรือ 2, 4 และ 6 เดือน โดยเริ่มเข็มแรกในช่วงอายุที่กำหนดและให้ครบก่อนอายุสูงสุดตามแนวทาง',
    sideEffect: 'อาจมีไข้ ถ่ายเหลว หรืออาเจียนเล็กน้อย',
    caution: 'ไม่แนะนำในผู้มี SCID หรือเคยมีภาวะลำไส้กลืนกัน และควรใช้ตามช่วงอายุที่กำหนด',
    page: 'อ้างอิงตารางหน้า 5 และรายละเอียดวัคซีนในเอกสาร',
  },
  'MMR': {
    title: 'วัคซีนหัด-คางทูม-หัดเยอรมัน (MMR)',
    disease: 'ป้องกันโรคหัด คางทูม และหัดเยอรมัน ซึ่งสามารถทำให้เกิดภาวะแทรกซ้อนรุนแรงได้',
    recommendation: 'ตามตารางพื้นฐานให้เข็มที่ 1 อายุ 9 เดือน และเข็มที่ 2 อายุ 1 ปี 6 เดือน',
    sideEffect: 'อาจมีไข้ ผื่น หรืออาการคล้ายหวัดหลังฉีด',
    caution: 'เป็นวัคซีนเชื้อเป็น หลีกเลี่ยงในหญิงตั้งครรภ์และผู้มีภูมิคุ้มกันบกพร่องรุนแรง',
    page: 'อ้างอิงตารางหน้า 5',
  },
  'Live JE': {
    title: 'วัคซีนไข้สมองอักเสบเจอีชนิดเชื้อเป็น (Live JE)',
    disease: 'ป้องกันโรคไข้สมองอักเสบเจอี ซึ่งเป็นโรคติดเชื้อไวรัสที่อาจทำให้สมองอักเสบรุนแรง',
    recommendation: 'ตามตารางพื้นฐานให้เข็มที่ 1 อายุ 1 ปี และเข็มที่ 2 อายุ 2 ปี 6 เดือน',
    sideEffect: 'อาจมีไข้ ปวดบริเวณที่ฉีด หรืออาการไม่สบายเล็กน้อย',
    caution: 'เป็นวัคซีนเชื้อเป็น หลีกเลี่ยงในหญิงตั้งครรภ์และผู้มีภูมิคุ้มกันบกพร่องรุนแรง',
    page: 'หน้า 6',
  },
  'Influenza': {
    title: 'วัคซีนไข้หวัดใหญ่',
    disease: 'ป้องกันโรคไข้หวัดใหญ่และลดความเสี่ยงอาการรุนแรง โดยเฉพาะเด็กเล็ก ผู้สูงอายุ หญิงตั้งครรภ์ และผู้มีโรคประจำตัว',
    recommendation: 'อายุตั้งแต่ 6 เดือนขึ้นไป ฉีดปีละ 1 เข็ม หากเด็กอายุต่ำกว่า 9 ปีไม่เคยได้รับมาก่อน ให้ 2 เข็มห่างกัน 1 เดือน',
    sideEffect: 'ปวด บวม แดงบริเวณที่ฉีด ไข้ต่ำ ๆ หรือปวดเมื่อยเล็กน้อย',
    caution: 'ประเมินประวัติแพ้วัคซีนหรือส่วนประกอบ และเลือกชนิดวัคซีนให้เหมาะกับอายุ/ภาวะสุขภาพ',
    page: 'หน้า 6 และหน้า 8',
  },
  'HPV': {
    title: 'วัคซีนเอชพีวี (HPV)',
    disease: 'ป้องกันการติดเชื้อ HPV ที่เกี่ยวข้องกับมะเร็งปากมดลูกและโรคจาก HPV บางชนิด',
    recommendation: 'ในแผนพื้นฐานแนะนำช่วงอายุ 11–12 ปี; วัคซีน 2 หรือ 4 สายพันธุ์ให้ 2 เข็มห่างกันอย่างน้อย 6 เดือน ส่วน 9 สายพันธุ์ในตารางพื้นฐานระบุ 1 เข็ม; ในวัคซีนทางเลือก อายุ 9–14 ปีให้ 2 เข็ม และ 15–45 ปีให้ 3 เข็ม',
    sideEffect: 'ปวด บวม แดงบริเวณที่ฉีด และอาจมีหน้ามืดเป็นลมได้ ควรนั่งสังเกตอาการหลังฉีด',
    caution: 'โดยทั่วไปเลื่อนฉีดในหญิงตั้งครรภ์ และประเมินประวัติแพ้รุนแรงต่อส่วนประกอบ',
    page: 'หน้า 6 และหน้า 8',
  },
  'DTaP/Tdap-IPV-Hib': {
    title: 'วัคซีนทางเลือกกลุ่ม DTaP/Tdap-IPV-Hib',
    disease: 'ป้องกันคอตีบ บาดทะยัก ไอกรน โปลิโอ ฮิบ และอาจรวมตับอักเสบบีในวัคซีนรวม 6 โรค',
    recommendation: 'ตารางทางเลือกให้เข็มที่ 1 อายุ 2 เดือน เข็มที่ 2 อายุ 4 เดือน เข็มที่ 3 อายุ 6 เดือน กระตุ้นที่ 1 ปี 6 เดือน, 4–6 ปี, 11–12 ปี และกระตุ้นผู้ใหญ่ทุก 10 ปี',
    sideEffect: 'ปวด บวม แดงบริเวณที่ฉีด มีไข้หรือร้องกวนได้',
    caution: 'ระวังประวัติแพ้รุนแรงหรือภาวะทางสมองที่ควบคุมไม่ได้ โดยเฉพาะวัคซีนที่มีส่วนประกอบไอกรน',
    page: 'หน้า 7',
  },
  'PCV': {
    title: 'วัคซีนนิวโมค็อกคัส (PCV)',
    disease: 'ป้องกันโรคนิวโมค็อกคัส เช่น ปอดอักเสบ เยื่อหุ้มสมองอักเสบ และติดเชื้อในกระแสเลือด',
    recommendation: 'ในเด็กเล็กให้ที่อายุ 2 และ 4 เดือน อาจมีเข็มที่ 6 เดือน และกระตุ้นที่ 12–15 เดือน; ผู้สูงอายุหรือกลุ่มเสี่ยงพิจารณา PCV ตามชนิดและประวัติวัคซีน',
    sideEffect: 'ปวด บวม แดงบริเวณที่ฉีด มีไข้หรืองอแงได้',
    caution: 'เลือกจำนวนเข็มตามอายุเริ่มฉีดและชนิดวัคซีน; ประเมินประวัติแพ้รุนแรง',
    page: 'หน้า 7',
  },
  'Inactivated JE': {
    title: 'วัคซีนไข้สมองอักเสบเจอีชนิดเชื้อตาย',
    disease: 'ป้องกันโรคไข้สมองอักเสบเจอี',
    recommendation: 'อายุตั้งแต่ 6 เดือนขึ้นไป ฉีด 3 ครั้ง โดยเข็มที่ 2 ห่างจากเข็มแรก 1–4 สัปดาห์ และเข็มที่ 3 ห่าง 1 ปี',
    sideEffect: 'อาจปวดบริเวณที่ฉีดหรือมีไข้ต่ำ ๆ',
    caution: 'ประเมินประวัติแพ้รุนแรงและภาวะเจ็บป่วยเฉียบพลันก่อนฉีด',
    page: 'หน้า 7',
  },
  'EV71': {
    title: 'วัคซีนอีวี 71 (EV71)',
    disease: 'ป้องกันโรคมือ เท้า ปาก ที่เกิดจากเชื้อ EV71 ซึ่งอาจทำให้เกิดภาวะแทรกซ้อนทางระบบประสาทรุนแรง',
    recommendation: 'ฉีดได้ช่วงอายุ 6 เดือนถึงน้อยกว่า 6 ปี จำนวน 2 ครั้ง ห่างกัน 1 เดือน',
    sideEffect: 'อาจปวด บวม แดงบริเวณฉีด หรือมีไข้เล็กน้อย',
    caution: 'ใช้ตามช่วงอายุที่ระบุ และประเมินประวัติแพ้รุนแรงก่อนฉีด',
    page: 'หน้า 7',
  },
  'HAV': {
    title: 'วัคซีนไวรัสตับอักเสบเอ (HAV)',
    disease: 'ป้องกันไวรัสตับอักเสบเอ ซึ่งติดต่อทางอาหารหรือน้ำปนเปื้อน',
    recommendation: 'อายุตั้งแต่ 1 ปีขึ้นไป ฉีด 2 ครั้ง ห่างกัน 6–12 เดือน',
    sideEffect: 'ปวดบริเวณที่ฉีด ไข้ต่ำ ๆ หรืออ่อนเพลียเล็กน้อย',
    caution: 'ประเมินประวัติแพ้รุนแรงต่อวัคซีนหรือส่วนประกอบ',
    page: 'หน้า 7',
  },
  'VZV/MMRV': {
    title: 'วัคซีนสุกใส / MMRV',
    disease: 'ป้องกันโรคสุกใส และในสูตร MMRV ป้องกันหัด คางทูม หัดเยอรมัน ร่วมด้วย',
    recommendation: 'วัคซีนสุกใสเข็มที่ 1 อายุ 12–15 เดือน และเข็มที่ 2 ช่วง 1 ปี 6 เดือน–4 ปี',
    sideEffect: 'อาจปวดบริเวณฉีด มีไข้ หรือมีผื่นคล้ายสุกใสเล็กน้อย',
    caution: 'เป็นวัคซีนเชื้อเป็น หลีกเลี่ยงในหญิงตั้งครรภ์และผู้มีภูมิคุ้มกันบกพร่องรุนแรง',
    page: 'หน้า 8',
  },
  'Dengue': {
    title: 'วัคซีนไข้เลือดออก',
    disease: 'ป้องกันโรคไข้เลือดออกจากไวรัสเดงกี ลดความเสี่ยงต่ออาการรุนแรงตามข้อบ่งใช้ของวัคซีน',
    recommendation: 'ตารางทางเลือกระบุแนะนำฉีดได้ตั้งแต่อายุ 10 ปีขึ้นไป โดยเฉพาะช่วง 10–14 ปี และ 45–60 ปี จำนวน 2 เข็ม ห่างกัน 3 เดือน',
    sideEffect: 'อาจปวดบริเวณที่ฉีด ไข้ หรือปวดเมื่อย',
    caution: 'ตรวจข้อบ่งใช้และข้อห้ามของวัคซีนแต่ละชนิด โดยเฉพาะประวัติภูมิคุ้มกันบกพร่อง/ตั้งครรภ์',
    page: 'หน้า 8',
  },
  'Rabies': {
    title: 'วัคซีนพิษสุนัขบ้า',
    disease: 'ป้องกันโรคพิษสุนัขบ้า ซึ่งเป็นโรครุนแรงและเสียชีวิตได้หากเกิดอาการแล้ว',
    recommendation: 'สำหรับก่อนสัมผัสโรค ฉีด 2 เข็ม; หลังสัมผัสโรคต้องประเมินแผล ประวัติวัคซีนเดิม และพิจารณา RIG ตามแนวทาง',
    sideEffect: 'ปวด บวม แดงบริเวณฉีด อาจมีไข้หรือปวดเมื่อยเล็กน้อย',
    caution: 'หลังสัมผัสโรคไม่ควรล่าช้า ควรล้างแผลและรับวัคซีนตามคำแนะนำ',
    page: 'หน้า 9',
  },
  'MenB': {
    title: 'วัคซีนไข้กาฬหลังแอ่นชนิด B (MenB)',
    disease: 'ป้องกันโรคไข้กาฬหลังแอ่นจากเชื้อ meningococcus group B ซึ่งอาจเกิดเยื่อหุ้มสมองอักเสบหรือติดเชื้อในกระแสเลือด',
    recommendation: 'จำนวนเข็มขึ้นกับอายุเริ่มฉีดและความเสี่ยง ในเด็กเล็กอาจมีหลายเข็มตามชนิดวัคซีน',
    sideEffect: 'ปวด บวม แดงบริเวณฉีด มีไข้ หรืออ่อนเพลียได้',
    caution: 'กลุ่ม asplenia/complement deficiency หรือได้รับ complement inhibitor มีความเสี่ยงสูง ควรปรึกษาแพทย์',
    page: 'รายละเอียดอ้างอิงตามวัคซีนไข้กาฬหลังแอ่นในเอกสาร',
  },
  'COVID-19': {
    title: 'วัคซีนโควิด 19',
    disease: 'ลดความเสี่ยงต่อการป่วยรุนแรงจาก COVID-19 โดยเฉพาะผู้สูงอายุและผู้มีโรคเรื้อรัง',
    recommendation: 'เอกสารระบุผู้มีอายุตั้งแต่ 60 ปีขึ้นไป รวมถึงผู้ใหญ่และเด็กที่มีโรคเรื้อรัง พิจารณาฉีดกระตุ้นปีละ 1 เข็มตามความสมัครใจ',
    sideEffect: 'ปวดบริเวณฉีด ไข้ ปวดเมื่อย หรืออ่อนเพลีย',
    caution: 'พิจารณาตามคำแนะนำล่าสุดของหน่วยงานสาธารณสุขและชนิดวัคซีนที่มี',
    page: 'หน้า 8–9',
  },
  'RSV': {
    title: 'วัคซีน/ภูมิคุ้มกันสำเร็จรูป RSV',
    disease: 'RSV เป็นสาเหตุสำคัญของโรคติดเชื้อทางเดินหายใจส่วนล่างรุนแรง เช่น หลอดลมอักเสบและปอดอักเสบ พบได้บ่อยในทารก เด็กเล็ก และผู้สูงอายุ',
    recommendation: 'วัคซีน RSV แนะนำในผู้สูงอายุตามอายุ/ความเสี่ยง และหญิงตั้งครรภ์ด้วยวัคซีนชนิด 2 สายพันธุ์ 1 เข็มช่วงอายุครรภ์ 24–36 สัปดาห์; Nirsevimab ใช้ในทารกกลุ่มเสี่ยง/ช่วงฤดูกาลระบาดตามข้อบ่งใช้',
    sideEffect: 'อาจปวดบริเวณฉีด ปวดศีรษะ หรือปวดกล้ามเนื้อ',
    caution: 'เลือกผลิตภัณฑ์ตามกลุ่มเป้าหมาย เช่น หญิงตั้งครรภ์ ทารก หรือผู้สูงอายุ และพิจารณาโรคร่วม/ความเสี่ยง',
    page: 'หน้า 8–9 และรายละเอียด RSV',
  },
};

// ── Date helpers ─────────────────────────────────────────────────
const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_DAYS         = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const EN_DAYS         = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EN_MONTHS       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(base, n) {
  return addDays(base, n * 30);
}

function calcDate(startDate, offset, factor) {
  if (factor === 'day') return addDays(startDate, offset);
  if (factor === 'month') return addMonths(startDate, offset);
  return new Date(startDate);
}

function formatTH(date) {
  const wd = TH_DAYS[date.getDay()];
  const d  = date.getDate();
  const m  = TH_MONTHS_SHORT[date.getMonth()];
  const y  = date.getFullYear() + 543;
  return `วัน${wd}ที่ ${d} ${m} ${y}`;
}

function formatEN(date) {
  const wd = EN_DAYS[date.getDay()];
  const d  = date.getDate();
  const m  = EN_MONTHS[date.getMonth()];
  const y  = date.getFullYear();
  return `${wd} ${d} ${m} ${y}`;
}

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function schedLabelShort(offset, factor) {
  if (factor === 'STAT') return 'STAT';
  if (factor === 'day')  return `Day ${offset}`;
  return `M${offset}`;
}

// ── UI metadata ──────────────────────────────────────────────────
const ROUTE_ICONS = { ID: '🌸', IM: '💪', SC: '🧬', Oral: '👄' };
const FACTOR_ICONS = { day: '📆', month: '🗓️', STAT: '⚡' };
const VACCINE_TYPE = {
  LIVE: { key: 'live', icon: '🦠', label: 'Live' },
  INACTIVE: { key: 'inactive', icon: '🛡️', label: 'Inactivated' },
};
const LIVE_VACCINE_NAMES = Object.entries(CLINICAL_META)
  .filter(([, meta]) => meta.type === 'live')
  .map(([name]) => name);
const DOSE_COLORS = ['dose-1','dose-2','dose-3','dose-4','dose-5'];

function vaccineType(vac) {
  const key = metaFor(vac).type === 'live' ? 'LIVE' : 'INACTIVE';
  return VACCINE_TYPE[key];
}

function vaccineEmoji(vac) {
  const text = `${vac.name} ${vac.remark || ''} ${vac.available || ''}`.toLowerCase();
  if (text.includes('rsv') || text.includes('arexvy') || text.includes('abrysvo')) return '🫁';
  if (text.includes('bexsero') || text.includes('menquadfi') || text.includes('menactra') || text.includes('meningococcal')) return '🧠';
  if (text.includes('deng')) return '🦟';
  if (text.includes('bcg')) return '🫁';
  if (text.includes('rabies')) return '🐕';
  if (text.includes('influenza') || text.includes('flu')) return '🤧';
  if (text.includes('rota')) return '👶';
  if (text.includes('pneumo')) return '🫁';
  if (text.includes('hepatitis') || text.includes('hep')) return '🧫';
  if (text.includes('hpv') || text.includes('gardasil') || text.includes('cervarix')) return '🎗️';
  if (text.includes('je') || text.includes('imojev')) return '🧠';
  if (text.includes('mmr') || text.includes('varicella')) return '🔴';
  if (text.includes('typhoid')) return '🚰';
  if (text.includes('tetanus') || text.includes('diphtheria') || text.includes('dtp') || text.includes('dt ') || text.includes('tt ')) return '🛡️';
  return '💉';
}

// ── Builders ─────────────────────────────────────────────────────
function buildCard(vac, startDate) {
  const card = document.createElement('div');
  card.className = 'vac-card';

  const head = document.createElement('div');
  head.className = 'vac-card-head';

  const visual = document.createElement('div');
  visual.className = 'vac-visual';
  visual.textContent = vaccineEmoji(vac);

  const titleBlock = document.createElement('div');
  titleBlock.className = 'vac-title-block';

  const nameEl = document.createElement('div');
  nameEl.className = 'vac-name';
  nameEl.textContent = vac.name;

  const badgeRow = document.createElement('div');
  badgeRow.className = 'badge-row';

  const meta = metaFor(vac);
  const route = meta.route || vac.route;
  if (route) {
    const rb = document.createElement('span');
    rb.className = `badge badge-route-${route}`;
    rb.textContent = `${ROUTE_ICONS[route] || '💉'} ${route}`;
    badgeRow.appendChild(rb);
  }

  const typeInfo = vaccineType(vac);
  const tb = document.createElement('span');
  tb.className = `badge badge-vaccine-type badge-vaccine-type-${typeInfo.key}`;
  tb.textContent = `${typeInfo.icon} ${typeInfo.label}`;
  badgeRow.appendChild(tb);

  const factorLabel = vac.factor === 'day' ? 'Day' : vac.factor === 'month' ? 'Month' : 'STAT';
  const fb = document.createElement('span');
  fb.className = `badge badge-factor-${vac.factor}`;
  fb.textContent = vac.factor === 'STAT'
    ? `${FACTOR_ICONS.STAT} STAT`
    : `${FACTOR_ICONS[vac.factor] || '📅'} ${factorLabel}: ${vac.schedule.join('·')}`;
  badgeRow.appendChild(fb);

  titleBlock.appendChild(nameEl);
  titleBlock.appendChild(badgeRow);
  head.appendChild(visual);
  head.appendChild(titleBlock);
  card.appendChild(head);

  const detailToggle = document.createElement('button');
  detailToggle.className = 'vac-body-toggle';
  detailToggle.type = 'button';
  detailToggle.setAttribute('aria-expanded', 'false');
  detailToggle.innerHTML = '<span class="collapse-chevron">▼</span><span>ดูตารางนัดและรายละเอียด</span>';
  card.appendChild(detailToggle);

  const body = document.createElement('div');
  body.className = 'vac-card-body';
  body.hidden = true;

  const table = document.createElement('table');
  table.className = 'dose-table';
  table.innerHTML = '<thead><tr><th style="width:40px">#</th><th style="width:84px">นัด</th><th>วันที่</th></tr></thead>';
  const tbody = document.createElement('tbody');

  vac.schedule.forEach((offset, idx) => {
    const date = calcDate(startDate, offset, vac.factor);
    const isToday = idx === 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="dose-num ${DOSE_COLORS[idx] || DOSE_COLORS[4]}">${idx + 1}</div></td>
      <td class="dose-sched">${schedLabelShort(offset, vac.factor)}</td>
      <td>
        <div class="dose-dates">
          <div class="dose-date-th">${isToday ? `${formatTH(date)} ★ วันแรก` : formatTH(date)}</div>
          <div class="dose-date-en">${isToday ? `${formatEN(date)} ★ Day 0` : formatEN(date)}</div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  const noteSection = document.createElement('div');
  noteSection.className = 'vac-note';
  noteSection.innerHTML = '<div class="vac-note-title"><span class="note-chevron-static">▲</span><span>หมายเหตุ / Note</span></div>';

  const noteBody = document.createElement('div');
  noteBody.className = 'vac-note-body';
  const noteText = [vac.remark, vac.remarkExtra].filter(Boolean).join('\n\n');
  const metaNote = document.createElement('div');
  metaNote.className = 'clinical-note';
  metaNote.innerHTML = `
    <div class="clinical-line"><strong>💉 Route:</strong> ${esc(meta.route || '-')}</div>
    <div class="clinical-line"><strong>👥 Age range:</strong> ${esc(meta.ageRange)}</div>
    <div class="clinical-line"><strong>⚠️ Special precaution:</strong> ${esc(meta.precaution)}</div>
  `;
  noteBody.appendChild(metaNote);

  if (noteText.trim()) {
    const originalNote = document.createElement('div');
    originalNote.className = 'original-note';
    originalNote.textContent = noteText.trim();
    noteBody.appendChild(originalNote);
  }

  if (vac.available) {
    const pill = document.createElement('span');
    pill.className = 'avail-pill';
    pill.textContent = `💊 ${vac.available}`;
    noteBody.appendChild(pill);
  }

  noteSection.appendChild(noteBody);
  body.appendChild(noteSection);
  card.appendChild(body);

  detailToggle.addEventListener('click', () => {
    const open = detailToggle.getAttribute('aria-expanded') === 'true';
    detailToggle.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  return card;
}

function buildMatrixTable(vaccines, ages, cellMap) {
  const table = document.createElement('table');
  table.className = 'schedule-matrix vaccine-y-axis';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th class="sticky-col vaccine-axis-head">วัคซีน</th>';
  ages.forEach(age => {
    const th = document.createElement('th');
    th.textContent = age;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  vaccines.forEach(vaccine => {
    const tr = document.createElement('tr');
    const vaccineTd = document.createElement('td');
    vaccineTd.className = 'sticky-col vaccine-name-cell';

    const btn = document.createElement('button');
    btn.className = 'vaccine-info-btn';
    btn.type = 'button';
    btn.textContent = vaccine;
    btn.title = `ดูข้อมูล ${vaccine}`;
    btn.addEventListener('click', (event) => showVaccineInfo(vaccine, event.currentTarget));
    vaccineTd.appendChild(btn);
    tr.appendChild(vaccineTd);

    ages.forEach(age => {
      const td = document.createElement('td');
      const value = (cellMap[age] && cellMap[age][vaccine]) || '';
      td.className = value ? 'filled-cell' : 'empty-cell';
      td.textContent = value || '—';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function showVaccineInfo(vaccineName, anchorEl) {
  const detail = THAI_VACCINE_DETAILS[vaccineName] || {
    title: vaccineName,
    disease: 'ยังไม่มีรายละเอียดเฉพาะในชุดข้อมูล popup นี้',
    recommendation: 'ตรวจสอบรายละเอียดจากเอกสารอ้างอิงหรือแนวทางล่าสุด',
    sideEffect: '-',
    caution: '-',
    page: 'เอกสาร PDF ที่อัปโหลด',
  };

  const bubble = document.getElementById('vaccineInfoBubble');
  const backdrop = document.getElementById('bubbleBackdrop');
  if (!bubble || !backdrop) return;

  bubble.innerHTML = `
    <button class="bubble-close" type="button" aria-label="Close">×</button>
    <div class="bubble-kicker">ข้อมูลจาก PDF · ${esc(detail.page)}</div>
    <div class="bubble-title">${esc(detail.title)}</div>
    <div class="bubble-section"><strong>ป้องกันโรค / Disease</strong><p>${esc(detail.disease)}</p></div>
    <div class="bubble-section"><strong>คำแนะนำ / Schedule</strong><p>${esc(detail.recommendation)}</p></div>
    <div class="bubble-section"><strong>อาการข้างเคียง</strong><p>${esc(detail.sideEffect)}</p></div>
    <div class="bubble-section"><strong>ข้อควรระวัง / ไม่แนะนำ</strong><p>${esc(detail.caution)}</p></div>
  `;

  backdrop.hidden = false;
  bubble.hidden = false;

  positionBubbleInViewport(bubble, anchorEl);

  bubble.querySelector('.bubble-close').addEventListener('click', hideVaccineInfo);
}

function positionBubbleInViewport(bubble, anchorEl) {
  // Keep the popup fully inside the visible screen on desktop and mobile.
  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  const bubbleWidth = Math.min(420, Math.max(280, viewportW - margin * 2));
  bubble.style.width = `${bubbleWidth}px`;
  bubble.style.maxHeight = `${Math.max(220, viewportH - margin * 2)}px`;

  // Reset first so measurement reflects the real size after content is inserted.
  bubble.style.left = '0px';
  bubble.style.top = '0px';

  const measured = bubble.getBoundingClientRect();
  const bubbleHeight = Math.min(measured.height, viewportH - margin * 2);

  // Prefer aligning the bubble center with the clicked vaccine name, then clamp.
  let left = rect.left + rect.width / 2 - bubbleWidth / 2;
  left = Math.max(margin, Math.min(left, viewportW - bubbleWidth - margin));

  // Prefer below the clicked vaccine name. If it would overflow, show above.
  let top = rect.bottom + gap;
  if (top + bubbleHeight > viewportH - margin) {
    top = rect.top - bubbleHeight - gap;
  }

  // If above also overflows, clamp within viewport.
  top = Math.max(margin, Math.min(top, viewportH - bubbleHeight - margin));

  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function hideVaccineInfo() {
  const bubble = document.getElementById('vaccineInfoBubble');
  const backdrop = document.getElementById('bubbleBackdrop');
  if (bubble) bubble.hidden = true;
  if (backdrop) backdrop.hidden = true;
}

function renderThaiScheduleTables() {
  const govWrap = document.getElementById('thaiGovMatrixWrap');
  const optWrap = document.getElementById('thaiOptionalMatrixWrap');
  const notesWrap = document.getElementById('thaiScheduleNotes');
  if (!govWrap || !optWrap || !notesWrap) return;

  govWrap.innerHTML = '';
  optWrap.innerHTML = '';
  notesWrap.innerHTML = '';

  govWrap.appendChild(buildMatrixTable(THAI_GOV_VACCINES, THAI_GOV_AGES, THAI_GOV_CELLS));
  optWrap.appendChild(buildMatrixTable(THAI_OPTIONAL_VACCINES, THAI_OPTIONAL_AGES, THAI_OPTIONAL_CELLS));

  THAI_SCHEDULE_NOTES.forEach(note => {
    const li = document.createElement('li');
    li.textContent = note;
    notesWrap.appendChild(li);
  });
}

// ── State ────────────────────────────────────────────────────────
let currentLang   = 'both';
let currentFactor = 'all';
let currentType   = 'all';
let currentRoute  = 'all';
let currentSearch = '';
let currentView   = 'thai';

function updateViewUI() {
  const thaiView = document.getElementById('thaiView');
  const otherView = document.getElementById('otherView');
  const navButtons = document.querySelectorAll('#viewNav .view-tab');
  navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.view === currentView));
  thaiView.hidden = currentView !== 'thai';
  otherView.hidden = currentView !== 'other';
}

// ── Render ───────────────────────────────────────────────────────
function renderVaccines() {
  const dateVal = document.getElementById('startDate').value;
  const startDate = dateVal ? new Date(dateVal) : new Date();
  const q = currentSearch.toLowerCase();

  const filtered = VACCINES.filter(v => {
    const meta = metaFor(v);
    if (currentFactor !== 'all' && v.factor !== currentFactor) return false;
    if (currentType !== 'all' && meta.type !== currentType) return false;
    if (currentRoute !== 'all' && meta.route !== currentRoute) return false;

    const haystack = [v.name, v.remark, v.remarkExtra, v.available, meta.route, meta.type, meta.ageRange, meta.precaution]
      .filter(Boolean)
      .join('\n\n')
      .toLowerCase();
    return !q || haystack.includes(q);
  });

  const grid = document.getElementById('cardsGrid');
  const summary = document.getElementById('summaryBar');
  grid.innerHTML = '';
  grid.classList.toggle('lang-th-hidden', currentLang === 'en');
  grid.classList.toggle('lang-en-hidden', currentLang === 'th');

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💉</div><div class="empty-state-text">ไม่พบวัคซีนที่ค้นหา</div></div>';
  } else {
    filtered.forEach(v => grid.appendChild(buildCard(v, startDate)));
  }

  summary.textContent = `แสดง ${filtered.length} จาก ${VACCINES.length} วัคซีน · Month = 30 days`;
}

function render() {
  updateViewUI();
  renderVaccines();
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderThaiScheduleTables();
  document.getElementById('bubbleBackdrop')?.addEventListener('click', hideVaccineInfo);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideVaccineInfo(); });

  const dateInput = document.getElementById('startDate');
  dateInput.value = todayISO();
  dateInput.addEventListener('change', renderVaccines);

  document.getElementById('viewNav').addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    currentView = btn.dataset.view;
    updateViewUI();
  });

  document.getElementById('langToggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    currentLang = btn.dataset.lang;
    document.querySelectorAll('#langToggle .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderVaccines();
  });

  document.getElementById('searchInput').addEventListener('input', e => {
    currentSearch = e.target.value;
    renderVaccines();
  });

  document.getElementById('factorFilter').addEventListener('click', e => {
    const chip = e.target.closest('[data-factor]');
    if (!chip) return;
    currentFactor = chip.dataset.factor;
    document.querySelectorAll('#factorFilter .chip').forEach(c => c.classList.toggle('active', c === chip));
    renderVaccines();
  });

  document.getElementById('typeFilter').addEventListener('click', e => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    currentType = chip.dataset.type;
    document.querySelectorAll('#typeFilter .chip').forEach(c => c.classList.toggle('active', c === chip));
    renderVaccines();
  });

  document.getElementById('routeFilter').addEventListener('click', e => {
    const chip = e.target.closest('[data-route]');
    if (!chip) return;
    currentRoute = chip.dataset.route;
    document.querySelectorAll('#routeFilter .chip').forEach(c => c.classList.toggle('active', c === chip));
    renderVaccines();
  });

  document.getElementById('btnResetFilters').addEventListener('click', () => {
    currentSearch = '';
    currentFactor = 'all';
    currentType = 'all';
    currentRoute = 'all';
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('#factorFilter .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
    document.querySelectorAll('#typeFilter .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
    document.querySelectorAll('#routeFilter .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
    renderVaccines();
  });

  render();
});
