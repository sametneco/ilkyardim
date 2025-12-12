// PDF.js worker configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global state
let extractedData = [];

// DOM Elements
const uploadBox = document.getElementById('uploadBox');
const fileInput = document.getElementById('fileInput');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultsSection = document.getElementById('resultsSection');
const resultsBody = document.getElementById('resultsBody');
const exportBtn = document.getElementById('exportBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');

// Drag and drop handlers
uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
});

uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
});

uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    const files = e.dataTransfer.files;
    handleFiles(files);
});

// File input handler
fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

// Handle file processing
async function handleFiles(files) {
    if (files.length === 0) return;

    extractedData = [];
    showProgress();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        updateProgress((i / files.length) * 100, `İşleniyor: ${file.name}`);

        try {
            const data = await processFile(file);
            if (data) {
                extractedData.push(data);
            }
        } catch (error) {
            console.error('Dosya işleme hatası:', error);
            alert(`Hata: ${file.name} işlenirken bir sorun oluştu.`);
        }
    }

    updateProgress(100, 'Tamamlandı!');
    setTimeout(() => {
        hideProgress();
        displayResults();
    }, 500);
}

// Process single PDF file
async function processFile(file) {
    console.log('Processing file:', file.name);
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';

    // Extract text from all pages
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
    }

    console.log('PDF.js extracted text length:', fullText.length);
    console.log('PDF.js text sample:', fullText.substring(0, 200));

    // If text extraction fails or is too short, use OCR
    if (fullText.trim().length < 100) {
        console.log('Text too short, using OCR...');
        fullText = await performOCR(file);
        console.log('OCR extracted text length:', fullText.length);
        console.log('OCR text sample:', fullText.substring(0, 200));
    }

    // Extract data using regex
    return extractDataFromText(fullText);
}

// Perform OCR on PDF
async function performOCR(file) {
    updateProgress(30, 'OCR hazırlanıyor...');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    // Use higher scale for better OCR accuracy
    const viewport = page.getViewport({ scale: 3.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // White background for better OCR
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    updateProgress(40, 'OCR başlatılıyor...');

    const { data: { text } } = await Tesseract.recognize(
        canvas,
        'tur+eng',  // Turkish and English
        {
            logger: m => {
                if (m.status === 'recognizing text') {
                    updateProgress(40 + (m.progress * 60), `OCR: %${Math.round(m.progress * 100)}`);
                }
            }
        }
    );

    return text;
}

// Extract data from text using regex
function extractDataFromText(text) {
    // Clean and normalize text
    const cleanText = text.replace(/\s+/g, ' ').trim();

    const data = {
        adSoyad: '',
        tcKimlik: '',
        belgeNo: '',
        gecerlilikTarihi: '',
        egitimBaslangic: '',
        egitimBitis: ''
    };

    console.log('Extracted Text Sample:', cleanText.substring(0, 500));

    // Ad Soyad - Multiple patterns to try
    let nameMatch = cleanText.match(/Sayın[:\s]+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü\s]{2,50}?)(?=\s*(?:TC|T\.C|Belge|[0-9]{11}|kapsamında))/i);
    if (!nameMatch) {
        // Try alternative pattern - name before TC number
        nameMatch = cleanText.match(/(?:Sayın|SAYIN)[:\s]+([A-ZÇĞİÖŞÜ\s]+?)(?=\s*\d{11})/i);
    }
    if (!nameMatch) {
        // Try pattern - name in all caps
        nameMatch = cleanText.match(/(?:Sayın|SAYIN)[:\s]+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s]+)/i);
    }
    if (nameMatch) {
        let name = nameMatch[1].trim().toUpperCase();

        // Remove all unwanted keywords (including partial matches)
        const unwantedWords = [
            'İLKYARDIM', 'ILKYARDIM', 'İLK', 'ILK',
            'YARDIM', 'YÖNETMELİĞİ', 'YONETMELIGI',
            'YÖNETMELIĞI',
            'KAPSAMINDA', 'KAPSAMI',
            'EĞİTİMİ', 'EGITIMI', 'EĞITIM', 'EGITIM'
        ];

        // Split into words and filter out unwanted ones
        const words = name.trim().split(/\s+/).filter(word => {
            if (word.length === 0) return false;
            // Check if word matches any unwanted word (exact or contains)
            for (const unwanted of unwantedWords) {
                if (word === unwanted || word.includes(unwanted) || unwanted.includes(word)) {
                    return false;
                }
            }
            return true;
        });

        // Take ALL remaining words (supports 2-3 word names)
        // Examples: "ÖMER ASLAN" or "MUHAMMED ALİ DOYRAN"
        name = words.join(' ');

        data.adSoyad = name.trim();
    }

    // TC Kimlik No - 11 haneli sayı (boşluksuz)
    const tcMatch = cleanText.match(/(?:TC|T\.C\.?|Kimlik)?[:\s]*(\d{11})\b/i);
    if (tcMatch) {
        data.tcKimlik = tcMatch[1];
    }

    // Belge No - Multiple formats
    let belgeMatch = cleanText.match(/Belge\s*(?:No|Numarası)?[:\s]*(SB[\.\s]*\d+[\.\s]*\d+)/i);
    if (!belgeMatch) {
        // Try without "Belge" prefix
        belgeMatch = cleanText.match(/(SB[\.\s]*\d{8,}[\.\s]*\d+)/i);
    }
    if (belgeMatch) {
        // Normalize format to SB.XXXXXXXX.XX (single dots only)
        data.belgeNo = belgeMatch[1].replace(/\s+/g, '').replace(/\.+/g, '.');
        // Ensure format is SB.XXXXXXXX.XX
        if (!data.belgeNo.match(/^SB\.\d+\.\d+$/)) {
            data.belgeNo = data.belgeNo.replace(/^SB\.?(\d+)(\d{2})$/, 'SB.$1.$2');
        }
    }

    // Geçerlilik Tarihi - Multiple patterns
    // Pattern 1: With "Belge" prefix and person name
    let gecerlilikMatch = cleanText.match(/Belge\s+Geçerlilik\s*Tarihi[:\s]*[A-ZÇĞİÖŞÜ\s]+?(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    if (!gecerlilikMatch) {
        // Pattern 2: Without "Belge" but with person name
        gecerlilikMatch = cleanText.match(/Geçerlilik\s*Tarihi[:\s]*[A-ZÇĞİÖŞÜ\s]+?(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    }
    if (!gecerlilikMatch) {
        // Pattern 3: Direct date after Geçerlilik Tarihi
        gecerlilikMatch = cleanText.match(/Geçerlilik\s*Tarihi[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    }
    if (!gecerlilikMatch) {
        // Pattern 4: Alternative short pattern
        gecerlilikMatch = cleanText.match(/(?:Geçerli|Geçerlilik)[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    }
    if (gecerlilikMatch) {
        data.gecerlilikTarihi = gecerlilikMatch[1].replace(/[\-\.]/g, '/');
    }

    // Eğitim tarihleri - "kapsamında" kelimesinden sonraki tarihler
    const kapsamindeIndex = cleanText.toLowerCase().indexOf('kapsamında');
    if (kapsamindeIndex !== -1) {
        const afterKapsaminda = cleanText.substring(kapsamindeIndex);
        const tarihler = afterKapsaminda.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/g);

        if (tarihler && tarihler.length >= 2) {
            data.egitimBaslangic = tarihler[0].replace(/[\-\.]/g, '/');
            data.egitimBitis = tarihler[1].replace(/[\-\.]/g, '/');
        }
    }

    // Alternatif: Tüm tarihleri bul
    if (!data.egitimBaslangic || !data.egitimBitis) {
        const allDates = cleanText.match(/\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/g);
        if (allDates && allDates.length >= 2) {
            // Son iki tarih genellikle eğitim tarihleri
            const len = allDates.length;
            data.egitimBaslangic = allDates[len - 2].replace(/[\-\.]/g, '/');
            data.egitimBitis = allDates[len - 1].replace(/[\-\.]/g, '/');
        }
    }

    console.log('Extracted Data:', data);
    return data;
}

// Display results in table
function displayResults() {
    resultsBody.innerHTML = '';

    extractedData.forEach((data, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="No">${index + 1}</td>
            <td data-label="Ad Soyad">${data.adSoyad || '-'}</td>
            <td data-label="TC Kimlik No">${data.tcKimlik || '-'}</td>
            <td data-label="Belge No">${data.belgeNo || '-'}</td>
            <td data-label="Belgenin Verildiği Tarih">${data.egitimBitis || '-'}</td>
            <td data-label="Belge Geçerlilik Tarihi">${data.gecerlilikTarihi || '-'}</td>
            <td data-label="Eğitim Merkezi">Bey Hekim İlk Yardım Eğitici Eğitim Merkezi</td>
        `;
        resultsBody.appendChild(row);
    });

    resultsSection.style.display = 'block';
}

// Export to Excel
exportBtn.addEventListener('click', () => {
    if (extractedData.length === 0) {
        alert('Dışa aktarılacak veri yok!');
        return;
    }

    // Prepare data for Excel
    const excelData = extractedData.map((data, index) => ({
        'No': index + 1,
        'Ad Soyad': data.adSoyad,
        'TC Kimlik No': data.tcKimlik,
        'Belge No': data.belgeNo,
        'Belgenin Verildiği Tarih': data.egitimBitis,
        'Belge Geçerlilik Tarihi': data.gecerlilikTarihi,
        'Eğitim Merkezi': 'Bey Hekim İlk Yardım Eğitici Eğitim Merkezi'
    }));

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
        { wch: 5 },   // No
        { wch: 25 },  // Ad Soyad
        { wch: 15 },  // TC Kimlik
        { wch: 20 },  // Belge No
        { wch: 20 },  // Belgenin Verildiği Tarih
        { wch: 20 },  // Belge Geçerlilik Tarihi
        { wch: 45 }   // Eğitim Merkezi
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Sertifikalar');

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `Sertifika_Verileri_${date}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
});

// Copy to Clipboard (for Google Sheets)
copyBtn.addEventListener('click', async () => {
    if (extractedData.length === 0) {
        alert('Kopyalanacak veri yok!');
        return;
    }

    try {
        // Prepare data as tab-separated values (TSV) for better paste compatibility
        const headers = ['No', 'Ad Soyad', 'TC Kimlik No', 'Belge No', 'Belgenin Verildiği Tarih', 'Belge Geçerlilik Tarihi', 'Eğitim Merkezi'];
        const rows = extractedData.map((data, index) => [
            index + 1,
            data.adSoyad || '',
            data.tcKimlik || '',
            data.belgeNo || '',
            data.egitimBitis || '',
            data.gecerlilikTarihi || '',
            'Bey Hekim İlk Yardım Eğitici Eğitim Merkezi'
        ]);

        // Create TSV format (tab-separated)
        const tsvContent = [headers, ...rows]
            .map(row => row.join('\t'))
            .join('\n');

        // Copy to clipboard
        await navigator.clipboard.writeText(tsvContent);

        // Show success message
        alert(`✅ ${extractedData.length} kayıt kopyalandı!

Google Sheets'e yapıştırmak için:
1. sheets.google.com'a gidin
2. Yeni sayfa oluşturun veya mevcut sayfayı açın
3. A1 hücresine tıklayın
4. Ctrl+V (veya Cmd+V) ile yapıştırın

Veriler otomatik olarak sütunlara ayrılacak!`);

    } catch (error) {
        console.error('Copy error:', error);
        alert('❌ Kopyalama başarısız. Tarayıcınız clipboard erişimini desteklemiyor olabilir.');
    }
});

// Clear results
clearBtn.addEventListener('click', () => {
    extractedData = [];
    resultsSection.style.display = 'none';
    fileInput.value = '';
});

// Progress helpers
function showProgress() {
    progressSection.style.display = 'block';
    resultsSection.style.display = 'none';
}

function hideProgress() {
    progressSection.style.display = 'none';
}

function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}
