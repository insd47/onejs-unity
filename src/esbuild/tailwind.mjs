/**
 * esbuild plugin for OneJS Tailwind -> USS transformation
 *
 * Usage:
 *   import "onejs:tailwind"
 *
 * This scans your source files for Tailwind class names and generates
 * USS (Unity Style Sheets) that gets embedded in the bundle.
 *
 * No external tailwindcss dependency required.
 */

import path from "node:path"
import { pathToFileURL } from "node:url"
import { generateFromFiles } from "../tailwind/generator.mjs"

/**
 * Create the Tailwind esbuild plugin
 *
 * @param {Object} options
 * @param {string[]} options.content - Content patterns to scan for classes
 * @param {string[]} [options.safelist] - Class names to always include (for dynamic/variable classes)
 * @param {string} [options.configPath] - Optional path to a `tailwind.config.js`
 *   (or `.mjs`) that exports `{ theme: { extend: { colors, spacing, fontFamily } }, plugins: [...] }`.
 *   Resolved relative to `process.cwd()` unless absolute. The file is dynamically
 *   imported on every build so watch-mode rebuilds pick up config edits.
 */
export function tailwindPlugin(options = {}) {
    const {
        content = ["./index.tsx", "./**/*.{tsx,ts,jsx,js}"],
        safelist = [],
        configPath,
    } = options

    async function loadUserConfig() {
        if (!configPath) return null
        const absPath = path.isAbsolute(configPath)
            ? configPath
            : path.resolve(process.cwd(), configPath)
        // Cache-bust so watch-mode rebuilds pick up config edits without
        // restarting the esbuild context.
        const url = `${pathToFileURL(absPath).href}?t=${Date.now()}`
        try {
            const mod = await import(url)
            return mod.default ?? mod
        } catch (err) {
            console.warn(`[tailwind-uss] Failed to load config at ${absPath}: ${err.message}`)
            return null
        }
    }

    return {
        name: "tailwind-uss",

        setup(build) {
            // Handle virtual import: import "onejs:tailwind"
            build.onResolve({ filter: /^onejs:tailwind$/ }, (args) => {
                return {
                    path: "onejs:tailwind",
                    namespace: "onejs-tailwind",
                }
            })

            // Generate USS for the virtual module
            build.onLoad({ filter: /.*/, namespace: "onejs-tailwind" }, async () => {
                try {
                    const userConfig = await loadUserConfig()

                    // Scan source files and generate USS
                    const ussContent = await generateFromFiles(content, {
                        includeReset: true,
                        safelist,
                        userConfig,
                    })

                    // Escape USS for JavaScript string embedding
                    const escapedUss = ussContent
                        .replace(/\\/g, "\\\\")
                        .replace(/`/g, "\\`")
                        .replace(/\$/g, "\\$")

                    // Generate JavaScript module that embeds USS and compiles at runtime
                    const jsContent = `// OneJS Tailwind USS
// Auto-generated from source files - do not edit

const css = \`${escapedUss}\`
compileStyleSheet(css, "tailwind.uss")

export default css
`

                    console.log(`[tailwind-uss] Generated ${ussContent.split("\n").length} lines${configPath ? ` (with config: ${configPath})` : ""}`)

                    return {
                        contents: jsContent,
                        loader: "js",
                    }
                } catch (error) {
                    console.error(`[tailwind-uss] Error:`, error.message)
                    return {
                        errors: [{ text: error.message }],
                    }
                }
            })
        },
    }
}

export default tailwindPlugin
