import { isAbsolute, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { createTemplateLibrary } from './lib/templates.js'
import { registerBusinessSkills } from './lib/business-skills.js'
import { registerOfficeContext, registerOfficeRoutes } from './lib/modes.js'
import { templateTool } from './lib/template-tool.js'
import { createDocxWorkflow, docxWriteTool, registerDocxDelivery } from './lib/docx-workflow.js'
import { createOfficeModes } from './lib/office-state.js'
import { createAuthoring, officeCreateTool } from './lib/authoring.js'

export const name = 'desktop-office'
export const inject = ['skills', 'sessionController', 'connection', 'webServer', 'tools', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess']
export const Config = Schema.object({
  root: Schema.string().required(), resources: Schema.string(), cli: Schema.string(),
  runtimeOwner: Schema.union(['plugin', 'desktop']).default('plugin'),
  maxInputBytes: Schema.natural().min(1).default(65536), maxSlides: Schema.natural().min(1).default(40),
  maxCells: Schema.natural().min(1).default(10000), maxDocuments: Schema.natural().min(1).default(50),
  maxActivities: Schema.natural().min(1).default(100), maxStateBytes: Schema.natural().min(1).default(2 * 1024 * 1024),
  maxDownloadBytes: Schema.natural().min(1).default(16 * 1024 * 1024), timeoutMs: Schema.natural().min(1).default(45000),
})

/** Installation-owned resources; neither Profile paths nor cwd are anchors. */
export async function apply(ctx, config) {
  if (!config || !isAbsolute(config.root ?? '') || (config.resources !== undefined && (!isAbsolute(config.resources) || !isAbsolute(config.cli ?? '')))) {
    throw new Error('desktop-office: an absolute state root and optional absolute resources and CLI paths are required')
  }
  let library = { async list() { return [] }, entry() { throw new Error('No template resources are installed') } }
  if (config.resources !== undefined) {
    await workspaceDependencies.resolvePrimaryRuntime(join(config.resources, 'primary-runtime'))
    if (config.runtimeOwner === 'plugin') {
      await ctx.plugin(workspaceDependencies, { source: join(config.resources, 'primary-runtime') })
      await ctx.plugin(officeSkills, { assetRoot: join(config.resources, 'office-skills'), node: process.execPath, cli: config.cli })
    }
    registerBusinessSkills(ctx, join(config.resources, 'business-skills'))
    library = await createTemplateLibrary(join(config.resources, 'templates'))
  } else if (config.runtimeOwner === 'plugin') await ctx.plugin(officeSkills, {})
  const modes = createOfficeModes(config.root, config, () => ctx.get('officePresentation'))
  ctx.effect(() => ctx.reflect.provide('officeModes', modes))
  const create = createAuthoring(ctx, modes, config)
  registerOfficeContext(ctx, library, modes)
  ctx.effect(() => ctx.tools.register(officeCreateTool(create, config)))
  if (config.resources !== undefined) {
    const docx = createDocxWorkflow(ctx, library, modes, config.resources)
    ctx.effect(() => ctx.tools.register(templateTool(ctx, library, modes, docx)))
    ctx.effect(() => ctx.tools.register(docxWriteTool(docx)))
    registerDocxDelivery(ctx, library, modes, docx)
  }
  registerOfficeRoutes(ctx, library, modes, create, config)
}
