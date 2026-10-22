/** Confined Office writer using maintained document libraries. */
import { Document, Packer, Paragraph, HeadingLevel } from 'docx'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Generate real OOXML bytes from the content supplied by the user or agent. */
export async function encodeOfficeDocument(request) {
  const { format, title, content } = request
  if (format === 'word') {
    const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), ...content.split('\n').map(text => new Paragraph({ text }))]
    return Packer.toBuffer(new Document({ title, creator: 'Oristrat', sections: [{ children }] }))
  }
  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook()
    workbook.title = title; workbook.creator = 'Oristrat'
    const sheetName = title.replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31).replace(/^'+|'+$/g, '').trim()
    const sheet = workbook.addWorksheet(!sheetName || sheetName === 'History' ? 'Sheet1' : sheetName)
    const rows = content.split('\n').map(line => line.split('\t').map(cell => /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cell) && Number.isSafeInteger(Number(cell.replace('.', ''))) ? Number(cell) : cell))
    sheet.addRows(rows)
    sheet.getRow(1).font = { bold: true }
    for (let column = 1; column <= Math.max(...rows.map(row => row.length)); column++) sheet.getColumn(column).width = 24
    return Buffer.from(await workbook.xlsx.writeBuffer())
  }
  const presentation = new PptxGenJS()
  presentation.layout = 'LAYOUT_WIDE'; presentation.title = title; presentation.author = 'Oristrat'
  presentation.subject = title
  for (const group of content.split(/\n\s*\n/)) {
    const [heading, ...lines] = group.split('\n')
    const slide = presentation.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addText(heading || title, { x: 0.65, y: 0.5, w: 12, h: 0.7, fontSize: 30, bold: true, color: '172E44', breakLine: false })
    slide.addText(lines.join('\n'), { x: 0.65, y: 1.6, w: 12, h: 5.1, fontSize: 20, color: '263849', valign: 'top', fit: 'shrink' })
    slide.addNotes(group)
  }
  return Buffer.from(await presentation.write({ outputType: 'nodebuffer' }))
}

/** Publish one new file in an exclusively owned directory; never overwrite user files. */
export async function materializeOfficeDocument(root, request) {
  root = await realpath(root)
  const parent = join(root, 'office-files')
  try { await mkdir(parent, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const info = await lstat(parent)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) throw new Error('Choose a regular Office output directory')
  const id = randomUUID(), directory = join(parent, id)
  await mkdir(directory, { mode: 0o700 })
  try {
    const bytes = await encodeOfficeDocument(request)
    const extension = { word: 'docx', excel: 'xlsx', ppt: 'pptx' }[request.format]
    const name = `${request.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || 'Document'}.${extension}`
    const file = await open(join(directory, name), 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    return { id, format: request.format, title: request.title, path: `office-files/${id}/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  process.stdout.write(JSON.stringify(await materializeOfficeDocument(process.cwd(), JSON.parse(Buffer.concat(chunks).toString('utf8')))))
}
