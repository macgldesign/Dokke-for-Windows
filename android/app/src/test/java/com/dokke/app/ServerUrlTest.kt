package com.dokke.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlTest {
    @Test
    fun normalizesLegitimateLanUrl() {
        assertEquals("http://192.168.1.5:3000/", ServerUrl.normalize(" HTTP://192.168.1.5:3000/ "))
        assertEquals("https://dokke.example:443", ServerUrl.normalize("https://DOKKE.EXAMPLE:443"))
    }

    @Test
    fun rejectsUnsafeOrIncompleteUrls() {
        assertNull(ServerUrl.normalize("javascript:alert(1)"))
        assertNull(ServerUrl.normalize("file:///tmp/dokke"))
        assertNull(ServerUrl.normalize("http://user:pass@192.168.1.5:3000"))
        assertNull(ServerUrl.normalize("http://:3000"))
        assertNull(ServerUrl.normalize("http://192.168.1.5:70000"))
    }

    @Test
    fun navigationRequiresTheConfiguredOrigin() {
        val server = "http://192.168.1.5:3000/"
        assertTrue(ServerUrl.isSameOrigin(server, "http://192.168.1.5:3000/api/config#dock"))
        assertFalse(ServerUrl.isSameOrigin(server, "http://192.168.1.6:3000/"))
        assertFalse(ServerUrl.isSameOrigin(server, "https://192.168.1.5:3000/"))
        assertTrue(ServerUrl.isExternalWebUrl("https://example.com/docs"))
        assertFalse(ServerUrl.isExternalWebUrl("intent://example.com"))
    }

    @Test
    fun manualAddressAcceptsCommonFormats() {
        assertEquals(ServerUrl.ManualTarget("http://192.168.0.15:3000", null), ServerUrl.parseManual("192.168.0.15"))
        assertEquals(ServerUrl.ManualTarget("http://192.168.0.15:3001", null), ServerUrl.parseManual(" 192.168.0.15:3001 "))
        assertEquals(ServerUrl.ManualTarget("http://meu-pc:3000", null), ServerUrl.parseManual("http://meu-pc/"))
        assertEquals(ServerUrl.ManualTarget("https://dokke.example", null), ServerUrl.parseManual("https://dokke.example"))
    }

    @Test
    fun manualAddressReadsThePinFromTheQrLink() {
        assertEquals(
            ServerUrl.ManualTarget("http://192.168.0.15:3000", "1234"),
            ServerUrl.parseManual("http://192.168.0.15:3000/#pin=1234"),
        )
        assertEquals(ServerUrl.ManualTarget("http://192.168.0.15:3000", null), ServerUrl.parseManual("192.168.0.15:3000#pin=12"))
    }

    @Test
    fun manualAddressRejectsUnsafeInput() {
        assertNull(ServerUrl.parseManual(""))
        assertNull(ServerUrl.parseManual("javascript:alert(1)"))
        assertNull(ServerUrl.parseManual("http://user:pass@192.168.0.15"))
        assertNull(ServerUrl.parseManual("http://192.168.0.15:3000/admin"))
        assertNull(ServerUrl.parseManual("http://192.168.0.15:3000/?x=1"))
        assertNull(ServerUrl.parseManual("http://[fe80::1]:3000"))
        assertNull(ServerUrl.parseManual("192.168.0.15:99999"))
        assertNull(ServerUrl.parseManual("dois  espaços"))
    }
}
