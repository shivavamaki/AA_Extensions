window.DEFAULT_FORMULAS = [
  {
    "id": "conc.paraben",
    "name": "conc.paraben",
    "title": "conc.paraben",
    "defaultQty": 100,
    "uom": "mL",
    "shelfLifeDays": 365,
    "shelfLifeText": "หลังเตรียมแล้วมีอายุ 1 ปี",
    "ingredients": [
      {
        "no": 1,
        "name": "Propyl paraben powder",
        "baseAmount": 20,
        "baseTotal": 1000,
        "uom": "Gm",
        "calc": "ratio"
      },
      {
        "no": 2,
        "name": "Methyl paraben powder",
        "baseAmount": 100,
        "baseTotal": 1000,
        "uom": "Gm",
        "calc": "ratio"
      },
      {
        "no": 3,
        "name": "Propylene glycol",
        "prefix": "qs. to",
        "uom": "mL",
        "calc": "qsto"
      }
    ],
    "methodTemplates": [
      "ละลาย {ing0.name} {ing0.amountText} และ {ing1.name} {ing1.amountText} ด้วย {ing2.name} ประมาณ {total75} {totalUom}",
      "วางบน Hot plate พร้อมกับคนจนละลายหมด",
      "ยกลงจาก Hot plate แล้วปรับปริมาตรด้วย {ing2.name} {ing2.prefix} {totalText}"
    ]
  },
  {
    "id": "Vancomycin oral",
    "name": "Vancomycin oral",
    "title": "Vancomycin oral",
    "defaultQty": 100,
    "uom": "mL",
    "shelfLifeDays": 14,
    "shelfLifeText": "หลังเตรียมแล้วมีอายุ 14 วัน",
    "ingredients": [
      {
        "no": 1,
        "name": "Vancomycin inje. 500 mg",
        "baseAmount": 1,
        "baseTotal": 10,
        "uom": "vial",
        "calc": "ratio"
      },
      {
        "no": 2,
        "name": "SWI",
        "prefix": "qs. to",
        "uom": "mL",
        "calc": "qsto"
      }
    ],
    "methodTemplates": [
      "ละลาย {ing0.name} {ing0.amountText} และ {ing1.name} {ing1.amountText}"
    ]
  },
  {
    "id": "Prednisolone suspension 1mg1mL",
    "name": "Prednisolone suspension 1mg/1mL 60 mL",
    "title": "Prednisolone suspension 1mg/1mL 60 mL",
    "defaultQty": 100,
    "uom": "mL",
    "shelfLifeDays": 30,
    "shelfLifeText": "หลังผสมแล้วมีอายุ 30 วัน",
    "ingredients": [
      {
        "no": 1,
        "name": "Prednisolone tab 5 mg",
        "baseAmount": 200,
        "baseTotal": 1000,
        "uom": "tab",
        "calc": "ratio"
      },
      {
        "no": 2,
        "name": "conc.paraben",
        "baseAmount": 10,
        "baseTotal": 1000,
        "uom": "mL",
        "calc": "ratio"
      },
      {
        "no": 3,
        "name": "Simple Syrup 85%",
        "uom": "mL",
        "calc": "remainder",
        "subtract": [
          1
        ]
      }
    ],
    "methodTemplates": [
      "บดยา {ing0.name} จำนวน {ing0.amountText} เตรียมใส่ Beaker แห้ง ตามขนาดที่เหมาะสมไว้",
      "ชั่งนำผงยาทั้งหมดและคำนวณหาน้ำหนักผงยาของตัวยา Prednisolone 60 mg และแบ่งบรรจุผงยาดังกล่าวในขวดแก้วสีชา",
      "ผสม {ing1.name} {ing1.amountText} และ {ing2.name} {ing2.amountText} เข้าด้วยกันโดยใช้ Beaker ตามขนาดที่เหมาะสม",
      "แบ่งบรรจุ Vehicle ที่ได้ในขวดแก้วสีชา ตามปริมาตรที่เหมาะสม"
    ]
  },
  {
    "id": "Favipiravir syrup",
    "name": "Favipiravir syrup 100mg/1mL",
    "title": "Favipiravir syrup 100mg/1mL",
    "defaultQty": 100,
    "uom": "mL",
    "shelfLifeDays": 14,
    "shelfLifeText": "หลังผสมแล้วมีอายุ 14 วัน",
    "ingredients": [
      {
        "no": 1,
        "name": "Favipiravir tab 200 mg",
        "baseAmount": 50,
        "baseTotal": 100,
        "uom": "tab",
        "calc": "ratio"
      },
      {
        "no": 2,
        "name": "Sterile water for inj.",
        "baseAmount": 20,
        "baseTotal": 100,
        "uom": "mL",
        "calc": "ratio"
      },
      {
        "no": 3,
        "name": "Simple syrup 85%",
        "prefix": "qs. to",
        "uom": "mL",
        "calc": "qsto"
      }
    ],
    "methodTemplates": [
      "ละลาย {ing0.name} {ing0.amountText} ด้วย {ing1.name} {ing1.amountText}",
      "ปรับปริมาตรด้วย {ing2.name} {ing2.prefix} {totalText}",
      "แบ่งบรรจุยาที่ละลายได้ในขวดแก้วสีชาตามปริมาตรที่เหมาะสม"
    ]
  },
  {
    "id": "Chloral hydrate (100mgmL)",
    "name": "Chloral hydrate (100mg/mL)",
    "title": "Chloral hydrate (100mg/mL)",
    "defaultQty": 30,
    "uom": "mL",
    "shelfLifeDays": 365,
    "shelfLifeText": "หลังเตรียมแล้วมีอายุ 1 ปี",
    "ingredients": [
      {
        "no": 1,
        "name": "Chloral hydrate",
        "baseAmount": 45,
        "baseTotal": 450,
        "uom": "Gm",
        "calc": "ratio"
      },
      {
        "no": 2,
        "name": "Sterile Water for Irrigation",
        "baseAmount": 22.5,
        "baseTotal": 450,
        "uom": "mL",
        "calc": "ratio"
      },
      {
        "no": 3,
        "name": "Simple Syrup",
        "prefix": "qs. to",
        "uom": "mL",
        "calc": "qsto"
      }
    ],
    "methodTemplates": [
      "บด {ing0.name} {ing0.amountText} ด้วยโกร่ง",
      "ละลายผง {ing0.name} ด้วย {ing1.name} {ing1.amountText}",
      "ปรับปริมาตรด้วย {ing2.name} {ing2.prefix} {totalText}"
    ]
  },
  {
    "id": "Sodium Potassium Phosphate solution",
    "name": "Sodium Potassium Phosphate solution",
    "title": "Sodium Potassium Phosphate solution - working formula",
    "defaultQty": 1000,
    "uom": "mL",
    "shelfLifeDays": 180,
    "shelfLifeText": "Room temp.; Expire date 6 เดือน",
    "note": "ประกอบด้วย Sodium 0.394 mEq/mL, Potassium 0.375 mEq/mL, Phosphate 0.519 mEq/mL",
    "ingredients": [
      {
        "no": 1,
        "code": "51171628000003",
        "name": "Potassium Di Hydrogen Phosphate Powder",
        "baseAmount": 17.011,
        "baseTotal": 1000,
        "uom": "g",
        "calc": "ratio"
      },
      {
        "no": 2,
        "code": "51171628000002",
        "name": "Di-Potassium Hydrogen Phosphate",
        "baseAmount": 21.773,
        "baseTotal": 1000,
        "uom": "g",
        "calc": "ratio"
      },
      {
        "no": 3,
        "code": "51171628000007",
        "name": "Disodium Hydrogen Phosphate",
        "baseAmount": 17.745,
        "baseTotal": 1000,
        "uom": "g",
        "calc": "ratio"
      },
      {
        "no": 4,
        "code": "51171628000009",
        "name": "Sodium Dihydrogen Phosphate",
        "baseAmount": 17.249,
        "baseTotal": 1000,
        "uom": "g",
        "calc": "ratio"
      },
      {
        "no": 5,
        "code": "",
        "name": "paraben conc",
        "baseAmount": 10,
        "baseTotal": 1000,
        "uom": "mL",
        "calc": "ratio"
      },
      {
        "no": 6,
        "code": "",
        "name": "purified water",
        "prefix": "qs. to",
        "uom": "mL",
        "calc": "qsto"
      }
    ],
    "methodTemplates": [
      "ชั่งผงยาและตวง paraben conc ตามที่ต้องการ",
      "ผสมผงยาทั้งหมดเข้าด้วยกัน",
      "เติมน้ำ 3/4 ของปริมาตรที่ต้องการเตรียม แล้วคนให้ละลายเข้ากัน",
      "ค่อย ๆ เติม paraben conc ลงไปทีละน้อย พร้อมคนเร็ว ๆ จนหมด",
      "ปรับปริมาตรให้ได้ตามที่ต้องการ",
      "นำสารละลายที่ได้ไปกรองด้วยกระดาษกรอง จนได้สารละลายใส"
    ]
  }
];
