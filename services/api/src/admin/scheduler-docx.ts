// Support module for admin/scheduler.ts — Word (.docx) export of a published
// schedule, split into its own file per the domain-module line-limit convention
// (see admin/ai-wizard-docx.ts for the sibling pattern with the AI wizard).
//
// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "en lugar de exportar a un CSV
// plano, lo que quiero que hagas es que exportes más bien un documento
// editable de Word, como lo hacemos en el Lux Planner. Que también tenga: el
// encabezado de la institución, información de la institución, quién está
// haciendo esto, cuáles son los horarios... en una tabla, por ejemplo la
// semana, y que se vea visualmente como un calendario de esa semana."

const INSTITUTION_NAME = process.env.INSTITUTION_NAME ?? 'Lux Learning';
const DAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export interface ScheduleDocxRow {
  dayOfWeek: number; // 0-6
  startTime: string; endTime: string;
  courseTitle: string; teacherName: string;
  modality: string; // 'Presencial' | 'Virtual'
  classType: string; // 'Grupal' | 'Individual'
  studentCount: number;
}

interface ScheduleDocxParams {
  academicPeriod: string;
  generatedByName: string;
  rows: ScheduleDocxRow[];
}

/** Renders the published schedule as a Word doc: one visual "week calendar" table
 *  (Monday-Saturday columns, chronological rows) instead of a flat CSV dump. */
export async function buildScheduleDocx({ academicPeriod, generatedByName, rows }: ScheduleDocxParams): Promise<Buffer> {
  // Same dynamic-import dance as ai-wizard-docx.ts — esbuild's CJS interop for
  // the pure-CJS `docx` package doesn't reliably land exports under `.default`.
  const importedDocx = await import('docx') as any;
  const docxPkg = importedDocx.default ?? importedDocx;
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel, Header, Footer } = docxPkg;
  if (!Document || !Packer) throw new Error('docx module did not resolve Document/Packer exports');

  const border = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
  const cellBorders = { top: border, bottom: border, left: border, right: border };
  const hCell = (text: string, shade = 'DBEAFE') => new TableCell({ shading: { fill: shade }, borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18 })] })] });
  const dCell = (text: string) => new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })] });

  // Info table — institución + quién generó el documento + cuándo.
  const genDate = new Date().toLocaleDateString('es-CR');
  const infoRows = [
    ['Institución', INSTITUTION_NAME],
    ['Período académico', academicPeriod],
    ['Generado por', generatedByName],
    ['Fecha de generación', genDate],
  ];
  const infoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: infoRows.map(([k, v]) => new TableRow({ children: [hCell(k, 'EFF6FF'), dCell(v)] })),
  });

  // Week-calendar table — Monday(1) through Saturday(6) as columns (Sunday is
  // never scheduled per the WBS: presencial=sábado, virtual=lunes-viernes),
  // one row per distinct start time across the week, sorted chronologically.
  const weekDays = [1, 2, 3, 4, 5, 6];
  const times = [...new Set(rows.map((r) => r.startTime))].sort();
  const cellText = (r: ScheduleDocxRow) =>
    `${r.courseTitle}\n${r.teacherName}\n${r.startTime}-${r.endTime} · ${r.modality === 'Presencial' ? 'Presencial' : 'Virtual'} · ${r.classType}${r.studentCount ? ` · ${r.studentCount} est.` : ''}`;
  const calendarRows = [
    new TableRow({ children: [hCell('Hora'), ...weekDays.map((d) => hCell(DAY_LABEL[d]))] }),
    ...times.map((t) => new TableRow({
      children: [
        hCell(t, 'F1F5F9'),
        ...weekDays.map((d) => {
          const matches = rows.filter((r) => r.dayOfWeek === d && r.startTime === t);
          return dCell(matches.length ? matches.map(cellText).join('\n\n') : '—');
        }),
      ],
    })),
  ];
  const calendarTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: calendarRows });

  const h1 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, bold: true, size: 32, color: '17527E' })] });
  const h2 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true, size: 24, color: '17527E' })] });
  const spacer = () => new Paragraph({ children: [] });

  const pageHeader = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${INSTITUTION_NAME} — Horario Institucional`, size: 16, color: '17527E', italics: true })] })] });
  const pageFooter = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${INSTITUTION_NAME} · Generado con Lux Scheduler · ${genDate}`, size: 16, color: '999999' })] })] });

  const doc = new Document({
    sections: [{
      headers: { default: pageHeader },
      footers: { default: pageFooter },
      children: [
        h1('HORARIO INSTITUCIONAL'),
        new Paragraph({ children: [new TextRun({ text: academicPeriod, bold: true, size: 28 })] }),
        spacer(),
        h2('1. Información General'),
        infoTable,
        spacer(),
        h2('2. Calendario Semanal'),
        calendarTable,
      ],
    }],
  });

  return Packer.toBuffer(doc);
}
