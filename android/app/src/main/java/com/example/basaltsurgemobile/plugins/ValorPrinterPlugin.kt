package com.example.basaltsurgemobile.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.Typeface
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.valor.valorsdk.Util.ValorPrint

@CapacitorPlugin(name = "ValorPrinter")
class ValorPrinterPlugin : Plugin() {

    companion object {
        const val TAG = "ValorPrinterPlugin"
        const val THERMAL_PAPER_WIDTH = 384 // 58mm paper roll width in dots (8 dots/mm * 48mm printable)

        // Status codes returned by ValorPrint.initPrinter() and print()
        const val STATUS_SUCCESS = 0
        const val STATUS_OUT_OF_PAPER = -1
        const val STATUS_INIT_PRINTER_ERROR = -2
        const val STATUS_PRINT_DATA_ERROR = -3
        const val STATUS_PRINT_NOT_SUPPORT = -4
    }

    private fun ensureServiceInitialized() {
        try {
            val p2 = com.valor.valorvp500sdk.p2.a()
            if (!p2.c()) {
                Log.d(TAG, "Initializing NSDK ServiceHelper on p2...")
                val moduleManager = com.newland.nsdk.core.internal.NSDKModuleManagerImpl.getInstance()
                moduleManager.init(context.applicationContext)
                p2.b = moduleManager
                p2.a = java.lang.ref.WeakReference(context.applicationContext)
                Log.d(TAG, "NSDK ServiceHelper initialized successfully on p2.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error ensuring NSDK service initialized", e)
            try {
                com.valor.valorsdk.ValorSDK().SDKInt(context.applicationContext, 1, object : com.valor.valorsdk.Listener.OnResult {
                    override fun Success() { Log.d(TAG, "ValorSDK.SDKInt succeeded") }
                    override fun Onprocess(p: String?) {}
                    override fun Fail(err: String?) { Log.e(TAG, "ValorSDK.SDKInt failed: $err") }
                })
            } catch (e2: Exception) {
                Log.e(TAG, "ValorSDK.SDKInt exception: ${e2.message}")
            }
        }
    }

    /**
     * Initializes a fresh ValorPrint instance per print job to avoid dirty buffer retention.
     * Includes retry polling in case the underlying Valor/Newland SDK service is still completing binding.
     */
    private fun getPrinterWithRetry(): ValorPrint? {
        ensureServiceInitialized()
        for (attempt in 1..5) {
            try {
                val p = ValorPrint()
                val status = p.initPrinter()
                Log.d(TAG, "getPrinterWithRetry attempt $attempt: init status = $status")
                
                // If SUCCESS (0) or OUT_OF_PAPER (-1), the SDK driver is bound and responding
                if (status == STATUS_SUCCESS || status == STATUS_OUT_OF_PAPER) {
                    // Set Newland hardware thermal printhead burn density to high (range 1-10, 8 gives crisp dark print)
                    try {
                        p.printer?.a?.setGray(8)
                        Log.d(TAG, "Newland printer density set to 8 via p.printer.a")
                    } catch (e: Exception) {
                        try {
                            val nModule = com.newland.nsdk.core.internal.NSDKModuleManagerImpl.getInstance().getModule("PRINTER")
                            (nModule as? com.newland.nsdk.core.api.internal.printer.Printer)?.setGray(8)
                            Log.d(TAG, "Newland printer density set to 8 via NSDKModuleManagerImpl")
                        } catch (e2: Exception) {
                            Log.w(TAG, "Could not set printer gray level: ${e2.message}")
                        }
                    }
                    return p
                }
            } catch (e: Exception) {
                Log.w(TAG, "ValorPrint init attempt $attempt encountered exception: ${e.message}")
            }
            try {
                Thread.sleep(300)
            } catch (_: InterruptedException) {}
        }
        return null
    }

    @PluginMethod
    fun printText(call: PluginCall) {
        val text = call.getString("text")
        if (text == null) {
            call.reject("Missing text")
            return
        }

        Thread {
            try {
                val printer = getPrinterWithRetry()
                if (printer == null) {
                    call.reject("Valor Printer API not available")
                    return@Thread
                }

                val initStatus = printer.initPrinter()
                if (initStatus == STATUS_OUT_OF_PAPER) {
                    Log.w(TAG, "printText: Printer is out of paper")
                    call.reject("Printer is out of paper")
                    return@Thread
                } else if (initStatus != STATUS_SUCCESS) {
                    Log.e(TAG, "printText: initPrinter failed with status $initStatus")
                    call.reject("Printer init failed: $initStatus")
                    return@Thread
                }

                renderText(printer, text)

                // Feed clearance to ensure ticket passes the tear bar cleanly
                printer.feedPaper(180f)
                val result = printer.print()

                if (result == STATUS_SUCCESS) {
                    val res = JSObject()
                    res.put("success", true)
                    call.resolve(res)
                } else if (result == STATUS_OUT_OF_PAPER) {
                    call.reject("Printer ran out of paper during print")
                } else {
                    call.reject("Print failed with error code: $result")
                }
            } catch (e: Exception) {
                Log.e(TAG, "printText failed with exception", e)
                call.reject("Print failed: ${e.message}")
            }
        }.start()
    }

    @PluginMethod
    fun printImage(call: PluginCall) {
        val base64Data = call.getString("base64")
        if (base64Data.isNullOrEmpty()) {
            call.reject("Missing image base64 data")
            return
        }

        Thread {
            try {
                val printer = getPrinterWithRetry()
                if (printer == null) {
                    call.reject("Valor Printer API not available")
                    return@Thread
                }

                val initStatus = printer.initPrinter()
                if (initStatus == STATUS_OUT_OF_PAPER) {
                    Log.w(TAG, "printImage: Printer is out of paper")
                    call.reject("Printer is out of paper")
                    return@Thread
                } else if (initStatus != STATUS_SUCCESS) {
                    Log.e(TAG, "printImage: initPrinter failed with status $initStatus")
                    call.reject("Printer init failed: $initStatus")
                    return@Thread
                }

                val bmp = decodeAndFormatBitmap(base64Data)
                if (bmp == null) {
                    call.reject("Failed to decode base64 image data")
                    return@Thread
                }

                printer.drawimage(bmp)
                // Feed clearance to ensure image clears tear bar
                printer.feedPaper(180f)
                val result = printer.print()

                if (result == STATUS_SUCCESS) {
                    val res = JSObject()
                    res.put("success", true)
                    call.resolve(res)
                } else if (result == STATUS_OUT_OF_PAPER) {
                    call.reject("Printer ran out of paper during print")
                } else {
                    call.reject("Image print failed with error code: $result")
                }
            } catch (e: Exception) {
                Log.e(TAG, "printImage failed with exception", e)
                call.reject("Image print failed: ${e.message}")
            }
        }.start()
    }

    @PluginMethod
    fun printDocument(call: PluginCall) {
        val text = call.getString("text")
        val base64Data = call.getString("base64")

        // Guard: reject immediately if both text and base64 are empty
        if (text.isNullOrEmpty() && base64Data.isNullOrEmpty()) {
            Log.w(TAG, "printDocument: Both text and base64 are empty — nothing to print")
            call.reject("Nothing to print: both text and image are empty")
            return
        }

        Thread {
            try {
                val printer = getPrinterWithRetry()
                if (printer == null) {
                    call.reject("Valor Printer API not available")
                    return@Thread
                }

                val initStatus = printer.initPrinter()
                if (initStatus == STATUS_OUT_OF_PAPER) {
                    Log.w(TAG, "printDocument: Printer is out of paper")
                    call.reject("Printer is out of paper")
                    return@Thread
                } else if (initStatus != STATUS_SUCCESS) {
                    Log.e(TAG, "printDocument: initPrinter failed with status $initStatus")
                    call.reject("Printer init failed: $initStatus")
                    return@Thread
                }

                // 1. Render text lines if provided
                if (!text.isNullOrEmpty()) {
                    renderText(printer, text)
                }

                // 2. Render base64 image (QR code / logo) if provided
                if (!base64Data.isNullOrEmpty()) {
                    val bmp = decodeAndFormatBitmap(base64Data)
                    if (bmp != null) {
                        printer.drawimage(bmp)
                    } else {
                        Log.w(TAG, "printDocument: Image data decoding failed, continuing with text-only")
                    }
                }

                // 3. Feed clearance to ensure ticket passes the tear bar cleanly
                printer.feedPaper(180f)
                val result = printer.print()

                if (result == STATUS_SUCCESS) {
                    val res = JSObject()
                    res.put("success", true)
                    call.resolve(res)
                } else if (result == STATUS_OUT_OF_PAPER) {
                    call.reject("Printer ran out of paper during print")
                } else {
                    call.reject("Document print failed with error code: $result")
                }
            } catch (e: Exception) {
                Log.e(TAG, "printDocument failed with exception", e)
                call.reject("Document print failed: ${e.message}")
            }
        }.start()
    }

    /**
     * Renders a legacy 7-line receipt payload using native Valor printer APIs:
     * - drawTwotext: locks left labels to the left margin and amounts/types to the far right margin (x = 384 dots)
     * - Full-width dividers: 29 dashes at 21f monospace bold spans edge-to-edge across the entire printable width
     * - Centered headers and unclipped prompt text
     */
    private fun renderLegacyReceipt(printer: ValorPrint, rawText: String) {
        val lines = rawText.lines().map { it.trim() }.filter { it.isNotEmpty() }
        var brandName = "Basalt Surge"
        var opName: String? = null
        var timeStr: String? = null
        var rcptStr: String? = null
        var saleLabel = "Sale"
        var totalStr = "$0.00"
        var isFirstContentLine = true

        for (line in lines) {
            when {
                line.startsWith("Op:", ignoreCase = true) -> {
                    opName = line.substringAfter(":").trim()
                }
                line.startsWith("Time:", ignoreCase = true) -> {
                    timeStr = line.substringAfter(":").trim()
                }
                line.startsWith("Rcpt:", ignoreCase = true) -> {
                    rcptStr = line.substringAfter(":").trim().removePrefix("#")
                }
                line.all { it == '-' || it == '=' } -> {
                    // Divider
                }
                line.contains("$") -> {
                    val parts = line.split(Regex("\\s{2,}|\t"))
                    if (parts.size >= 2) {
                        saleLabel = parts[0].trim()
                        totalStr = parts[1].trim()
                    } else {
                        val dollarIdx = line.indexOf('$')
                        if (dollarIdx > 0) {
                            saleLabel = line.substring(0, dollarIdx).trim()
                            totalStr = line.substring(dollarIdx).trim()
                        } else {
                            totalStr = line
                        }
                    }
                }
                isFirstContentLine && !line.startsWith("Op:") && !line.startsWith("Time:") && !line.startsWith("Rcpt:") -> {
                    brandName = line
                    isFirstContentLine = false
                }
            }
        }

        val cleanOp = opName?.split("•")?.get(0)?.trim()
        val headerName = if (brandName.isBlank()) "TERMINAL" else brandName

        // 1. Header (Centered)
        printer.drawtext("*** ${headerName.uppercase()} ***", 23f, true, Paint.Align.CENTER)
        printer.feedPaper(6f)
        printer.drawtext("TERMINAL RECEIPT", 21f, true, Paint.Align.CENTER)
        if (timeStr != null) {
            printer.drawtext(timeStr, 20f, true, Paint.Align.CENTER)
        }

        // 2. Full-width divider (29 dashes fills 384 dots edge-to-edge)
        printer.drawtext("-".repeat(29), 21f, true, Paint.Align.LEFT)

        // 3. Operator & Type (Left flush & Right flush across full paper)
        if (cleanOp != null) {
            printer.drawTwotext("Op: $cleanOp", "Type: POS", 21f, true)
        } else {
            printer.drawTwotext("Type: POS", "Station: T-1", 21f, true)
        }

        // 4. Receipt # (Left aligned)
        if (rcptStr != null) {
            val shortId = rcptStr.replace("receipt:", "").trim().removePrefix("#").take(10)
            printer.drawtext("Rcpt: #$shortId", 21f, true, Paint.Align.LEFT)
        }

        // 5. Full-width divider
        printer.drawtext("-".repeat(29), 21f, true, Paint.Align.LEFT)

        // 6. Sale line (Left flush & Right flush across full paper)
        printer.drawTwotext(saleLabel, totalStr, 21f, true)

        // 7. Full-width divider
        printer.drawtext("-".repeat(29), 21f, true, Paint.Align.LEFT)

        // 8. Totals & Status (Left flush & Right flush across full paper)
        printer.drawTwotext("TOTAL", totalStr, 22f, true)
        printer.drawTwotext("STATUS", "PENDING", 21f, true)

        // 9. Full-width divider
        printer.drawtext("-".repeat(29), 21f, true, Paint.Align.LEFT)

        // 10. Call to action prompt (Centered at 17f so 'online' is never truncated)
        printer.feedPaper(6f)
        printer.drawtext("Scan QR below to pay online", 17f, true, Paint.Align.CENTER)
        printer.drawtext("or view receipt details.", 17f, true, Paint.Align.CENTER)
    }

    /**
     * Renders receipt text line-by-line with authentic POS bold monospace typography,
     * header centering, edge-to-edge divider lines, and two-column left/right margin pinning.
     */
    private fun renderText(printer: ValorPrint, text: String) {
        // Enforce bold monospace typeface for authentic, high-contrast POS thermal printing
        try {
            com.valor.valorvp500sdk.k.g = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        } catch (_: Exception) {}

        val isLegacy = !text.contains("TERMINAL RECEIPT", ignoreCase = true) && !text.contains("***") &&
                       (text.contains("Rcpt:", ignoreCase = true) || text.contains("Op:", ignoreCase = true) || text.contains("$"))

        if (isLegacy) {
            renderLegacyReceipt(printer, text)
            return
        }

        val lines = text.split("\n")
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isEmpty()) {
                printer.feedPaper(8f)
                continue
            }

            // Centered double-bracketed headers (e.g. *** STORE NAME ***)
            if (trimmed.startsWith("***") && trimmed.endsWith("***")) {
                printer.drawtext(trimmed, 23f, true, Paint.Align.CENTER)
            } else if (trimmed.equals("TERMINAL RECEIPT", ignoreCase = true) ||
                       trimmed.equals("GUEST RECEIPT", ignoreCase = true)) {
                printer.drawtext(trimmed, 21f, true, Paint.Align.CENTER)
            } else if (trimmed.matches(Regex("^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4},? .*"))) {
                // Centered timestamp under TERMINAL RECEIPT
                printer.drawtext(trimmed, 20f, true, Paint.Align.CENTER)
            } else if (trimmed.startsWith("Scan QR", ignoreCase = true) ||
                       trimmed.startsWith("or view", ignoreCase = true) ||
                       trimmed.startsWith("receipt and transaction", ignoreCase = true)) {
                // Call-to-action prompt above QR code (17f ensures full string fits with no character truncation)
                printer.drawtext(trimmed, 17f, true, Paint.Align.CENTER)
            } else if (trimmed.all { it == '-' || it == '=' }) {
                // Monospace divider line across thermal roll (29 dashes fills 384 dots edge-to-edge)
                printer.drawtext("-".repeat(29), 21f, true, Paint.Align.LEFT)
            } else {
                // Check if line contains left & right columns separated by 2 or more spaces or tab
                val parts = trimmed.split(Regex("\\s{2,}|\t"))
                if (parts.size >= 2) {
                    val isTotal = parts[0].equals("TOTAL", ignoreCase = true)
                    val size = if (isTotal) 22f else 21f
                    printer.drawTwotext(parts[0].trim(), parts[1].trim(), size, true)
                } else {
                    printer.drawtext(trimmed, 21f, true, Paint.Align.LEFT)
                }
            }
        }
    }

    /**
     * Decodes Base64 data, scales to thermal roll width, applies high-contrast monochrome
     * thresholding for deep black QR modules, and keeps vertical whitespace compact.
     * Relies on the post-print feedPaper(180f) to clear the physical tear bar.
     */
    private fun decodeAndFormatBitmap(base64Data: String): Bitmap? {
        return try {
            val cleaned = base64Data.substringAfter(",")
            val decodedBytes = Base64.decode(cleaned, Base64.DEFAULT)
            val rawBmp = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size) ?: return null

            val canvasWidth = THERMAL_PAPER_WIDTH // 384
            val targetQrSize = 320
            val scaledBmp = Bitmap.createScaledBitmap(rawBmp, targetQrSize, targetQrSize, false)

            // High contrast monochrome thresholding to ensure QR code modules are jet black
            val width = scaledBmp.width
            val height = scaledBmp.height
            val pixels = IntArray(width * height)
            scaledBmp.getPixels(pixels, 0, width, 0, 0, width, height)
            for (i in pixels.indices) {
                val color = pixels[i]
                val r = (color shr 16) and 0xFF
                val g = (color shr 8) and 0xFF
                val b = color and 0xFF
                val luminance = (0.299 * r + 0.587 * g + 0.114 * b).toInt()
                pixels[i] = if (luminance < 160) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            }
            val monoBmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            monoBmp.setPixels(pixels, 0, width, 0, 0, width, height)

            // Minimal vertical padding inside the bitmap — no artificial excess above/below
            val paddingTop = 4
            val paddingBottom = 4
            val canvasHeight = targetQrSize + paddingTop + paddingBottom

            val paddedBmp = Bitmap.createBitmap(canvasWidth, canvasHeight, Bitmap.Config.ARGB_8888)
            val canvas = android.graphics.Canvas(paddedBmp)
            canvas.drawColor(android.graphics.Color.WHITE)

            val xOffset = (canvasWidth - targetQrSize) / 2f
            canvas.drawBitmap(monoBmp, xOffset, paddingTop.toFloat(), null)
            paddedBmp
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode and format bitmap: ${e.message}", e)
            null
        }
    }
}
