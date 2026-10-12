'use strict';
// Verifica el plan de conteos cíclicos: la cantidad diaria y su reparto por clase son un resultado matemático del plan ABC.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'abasto-plan-'));
const assert = require('node:assert/strict');
const L = require('../lib');

function anio(nombre, n, v, dias) {
  const anual = n.A * v.A + n.B * v.B + n.C * v.C;
  const cls = { cfg: { vueltasA: v.A, vueltasB: v.B, vueltasC: v.C, dias_operativos: dias }, conteo: n, items_diarios: Math.ceil(anual / dias) };
  let arr = {}; const tot = { A: 0, B: 0, C: 0 }; let minDia = 1e9, maxDia = 0;
  for (let d = 0; d < dias; d++) {
    const r = L.cuotasDelDia(cls, arr);
    const suma = r.cuota.A + r.cuota.B + r.cuota.C;
    assert.equal(suma, cls.items_diarios, `${nombre}: el día ${d + 1} reparte ${suma} en vez de ${cls.items_diarios}`);
    for (const k of ['A', 'B', 'C']) { tot[k] += r.cuota[k]; assert.ok(r.cuota[k] <= n[k]); }
    minDia = Math.min(minDia, suma); maxDia = Math.max(maxDia, suma); arr = r.arrastre;
  }
  const total = tot.A + tot.B + tot.C;
  for (const k of ['A', 'B', 'C']) {
    const plan = n[k] * v[k];
    assert.ok(tot[k] >= plan - 1, `${nombre}: la clase ${k} recibió ${tot[k]} conteos en el año y el plan exige ${plan}`);
    const proporcional = (total * plan) / anual;
    assert.ok(Math.abs(tot[k] - proporcional) <= 2, `${nombre}: la clase ${k} se desvía de su proporción (${tot[k]} vs ${proporcional.toFixed(1)})`);
  }
  console.log(`  ${nombre}: ${cls.items_diarios} ítems/día (plan anual ${anual} ÷ ${dias} días) → en el año A ${tot.A}/${n.A * v.A}, B ${tot.B}/${n.B * v.B}, C ${tot.C}/${n.C * v.C}`);
}

// Ejemplo del documento de parámetros: 300 productos, A=50%, B=30%, C=20%, vueltas 12/6/2, 300 días → 2460 anuales → 9 por día
anio('Ejemplo del plan (300 productos)', { A: 150, B: 90, C: 60 }, { A: 12, B: 6, C: 2 }, 300);
// Configuración recomendada para el abasto: 60 A, 120 B, 120 C
anio('Abasto recomendado', { A: 60, B: 120, C: 120 }, { A: 12, B: 6, C: 2 }, 300);
// Catálogo pequeño: una clase con menos productos que su cuota no debe romper el reparto
anio('Catálogo pequeño', { A: 2, B: 3, C: 5 }, { A: 12, B: 6, C: 2 }, 300);
// Sin productos en una clase
anio('Sin clase C', { A: 10, B: 20, C: 0 }, { A: 12, B: 6, C: 2 }, 250);
// Aritmética del documento
const cls = { cfg: { vueltasA: 12, vueltasB: 6, vueltasC: 2, dias_operativos: 300 }, conteo: { A: 150, B: 90, C: 60 }, items_diarios: 9 };
assert.deepEqual(Object.values(L.cuotasDelDia(cls, {}).cuota).reduce((a, b) => a + b, 0), 9);
console.log('\nOK: el plan de conteos cumple las vueltas anuales de cada clase.');
process.exit(0);
