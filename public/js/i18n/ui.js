// Keyed strings used by the page modules. Each entry is [English, Arabic].
// Static markup is handled by static-ar.js; this file is only for text that
// JavaScript renders or updates at runtime.
export const ui = {
  'lang.switch': ['Switch language', 'تغيير اللغة'],

  'theme.toggle': ['Toggle theme', 'تبديل السمة'],
  'theme.dark': ['Dark', 'داكن'],
  'theme.light': ['Light', 'فاتح'],
  'theme.toDark': ['Switch to dark theme', 'التبديل إلى السمة الداكنة'],
  'theme.toLight': ['Switch to light theme', 'التبديل إلى السمة الفاتحة'],
  'theme.toAuto': ['Switch to automatic theme', 'التبديل إلى السمة التلقائية'],
  'theme.auto': ['Auto', 'تلقائي'],

  'ping.label': ['Ping', 'زمن الاستجابة'],
  'ping.good': ['Excellent', 'ممتاز'],
  'ping.fair': ['Fair', 'مقبول'],
  'ping.poor': ['Poor', 'ضعيف'],
  'ping.offline': ['Offline', 'غير متصل'],
  'ping.avg': ['Average', 'المتوسط'],
  'ping.jitter': ['Jitter', 'الاهتزاز'],
  'ping.connection': ['Connection', 'الاتصال'],

  'meta.landingTitle': [
    'Hush — quiet rooms for voice, video, and text',
    'Hush — غرف هادئة للصوت والفيديو والنص'
  ],
  'meta.landingDescription': [
    'Text, voice, video, and screen sharing in one calm room. No downloads, no accounts. Just a link and the people you want to talk to.',
    'نص وصوت وفيديو ومشاركة شاشة في غرفة واحدة هادئة. بلا تنزيلات وبلا حسابات. مجرد رابط والأشخاص الذين تريد التحدث إليهم.'
  ],
  'meta.roomTitle': ['Room {code} — Hush', 'الغرفة {code} — Hush'],
  'meta.roomUntitled': ['Room — Hush', 'الغرفة — Hush'],
  'meta.roomDescription': [
    'A quiet room for text, voice, video, and screen sharing.',
    'غرفة هادئة للنص والصوت والفيديو ومشاركة الشاشة.'
  ],
  'meta.unreadTitle': ['({count}) {title}', '({count}) {title}'],
  'meta.notFoundTitle': ['Page not found — Hush', 'الصفحة غير موجودة — Hush'],

  'status.joining': ['Joining…', 'جارٍ الانضمام…'],
  'status.connected': ['Connected', 'متصل'],
  'status.notConnected': ['Not connected', 'غير متصل'],
  'status.reconnecting': ['Reconnecting…', 'جارٍ إعادة الاتصال…'],
  'status.connecting': ['Connecting…', 'جارٍ الاتصال…'],
  'status.rejoining': ['Rejoining…', 'جارٍ إعادة الانضمام…'],
  'status.offline': ['Offline', 'غير متصل'],

  'join.busy': ['Joining…', 'جارٍ الانضمام…'],
  'join.idle': ['Join room', 'انضم إلى الغرفة'],

  'error.invalidLink': [
    'This room link is missing a valid code. Go back and create a new room.',
    'رابط الغرفة لا يحتوي على رمز صالح. ارجع وأنشئ غرفة جديدة.'
  ],
  'error.nameRequired': ['Add a display name first.', 'أضف اسمًا معروضًا أولًا.'],
  'error.joinFailed': ['Could not join the room. Please try again.', 'تعذّر الانضمام إلى الغرفة. حاول مرة أخرى.'],
  'error.invalidCode': ['That room code is not valid.', 'رمز الغرفة غير صالح.'],
  'error.roomFull': [
    'This room is full. Try again later or open a new room.',
    'هذه الغرفة ممتلئة. حاول لاحقًا أو افتح غرفة جديدة.'
  ],
  'error.notInRoom': [
    'You are no longer in this room. Refresh to rejoin.',
    'لم تعد في هذه الغرفة. حدّث الصفحة لإعادة الانضمام.'
  ],
  'error.rateLimited': [
    'You are sending messages too quickly. Give it a moment.',
    'أنت ترسل الرسائل بسرعة كبيرة. انتظر لحظة.'
  ],
  'error.messageTooLong': ['That message is too long.', 'هذه الرسالة طويلة جدًا.'],
  'error.emptyMessage': ['Write a message or attach a file first.', 'اكتب رسالة أو أرفق ملفًا أولًا.'],
  'error.sendFailed': ['The message could not be sent. Try again.', 'تعذّر إرسال الرسالة. حاول مرة أخرى.'],
  'error.invalidReaction': ['That reaction is not available.', 'هذا التفاعل غير متاح.'],
  'error.messageNotFound': ['That message no longer exists.', 'هذه الرسالة لم تعد موجودة.'],
  'error.reactionFailed': ['Could not add that reaction.', 'تعذّر إضافة هذا التفاعل.'],
  'error.generic': ['Something went wrong. Please try again.', 'حدث خطأ ما. حاول مرة أخرى.'],
  'error.realtimeClient': [
    'The realtime client could not load. Refresh the page and try again.',
    'تعذّر تحميل عميل الاتصال المباشر. حدّث الصفحة وحاول مرة أخرى.'
  ],
  'error.serverUnreachable': [
    'Could not reach the room server. Check your connection and try again.',
    'تعذّر الوصول إلى خادم الغرفة. تحقّق من اتصالك وحاول مرة أخرى.'
  ],
  'error.serverConnect': ['Could not connect to the room server.', 'تعذّر الاتصال بخادم الغرفة.'],
  'error.serverNoResponse': ['The server did not respond. Try again.', 'لم يستجب الخادم. حاول مرة أخرى.'],
  'error.notConnected': ['Not connected.', 'غير متصل.'],
  'error.reconnectFailed': [
    'Could not reconnect. Refresh the page to try again.',
    'تعذّرت إعادة الاتصال. حدّث الصفحة وحاول مرة أخرى.'
  ],
  'error.uploadRoomGone': ['This room no longer exists. Refresh the page.', 'هذه الغرفة لم تعد موجودة. حدّث الصفحة.'],
  'error.uploadUnsupported': ['That file type is not supported.', 'نوع الملف غير مدعوم.'],
  'error.uploadTooLarge': ['Files must be 8 MB or smaller.', 'يجب ألا يتجاوز حجم الملف 8 ميغابايت.'],
  'error.uploadRateLimited': [
    'Too many uploads. Give it a minute and try again.',
    'عدد كبير من عمليات الرفع. انتظر دقيقة وحاول مرة أخرى.'
  ],
  'error.uploadFailed': ['The upload failed. Try again.', 'فشل الرفع. حاول مرة أخرى.'],

  'chat.you': ['You', 'أنت'],
  'chat.guest': ['Guest', 'ضيف'],
  'chat.muted': ['Muted', 'صامت'],
  'chat.handRaised': ['Hand raised', 'يد مرفوعة'],
  'chat.sharingScreen': ['Sharing screen', 'يشارك الشاشة'],
  'chat.cameraOn': ['Camera on', 'الكاميرا تعمل'],
  'chat.inRoom': ['In the room', 'في الغرفة'],
  'chat.empty': ['No messages yet. Say hello.', 'لا توجد رسائل بعد. ألقِ تحية.'],
  'chat.searchEmpty': ['No messages match “{query}”.', 'لا توجد رسائل تطابق «{query}».'],
  'chat.searchCount': ['{shown} of {total}', '{shown} من {total}'],
  'chat.typingOne': ['{name} is typing', '{name} يكتب…'],
  'chat.typingTwo': ['{a} and {b} are typing', '{a} و{b} يكتبان…'],
  'chat.typingMany': ['{count} people are typing', '{count} أشخاص يكتبون…'],
  'chat.offlineSend': [
    'You are offline. Reconnect before sending.',
    'أنت غير متصل. أعد الاتصال قبل الإرسال.'
  ],
  'chat.offlineUpload': [
    'You are offline. Reconnect before sharing a file.',
    'أنت غير متصل. أعد الاتصال قبل مشاركة ملف.'
  ],
  'chat.copy': ['Copy message text', 'نسخ نص الرسالة'],
  'chat.copied': ['Message copied.', 'تم نسخ الرسالة.'],
  'chat.copyFailed': ['Copy failed. Select the text instead.', 'تعذّر النسخ. حدّد النص بدلًا من ذلك.'],
  'chat.reactTitle': ['React to this message', 'تفاعل مع هذه الرسالة'],
  'chat.reactWith': ['React with {emoji}', 'تفاعل بـ {emoji}'],
  'chat.reactionOne': ['1 reaction', 'تفاعل واحد'],
  'chat.reactionMany': ['{count} reactions', '{count} تفاعلات'],
  'chat.reactOffline': ['Reconnect before reacting.', 'أعد الاتصال قبل التفاعل.'],
  'chat.reactionFailed': ['Could not add that reaction.', 'تعذّر إضافة هذا التفاعل.'],
  'chat.searchPlaceholder': ['Search messages', 'ابحث في الرسائل'],
  'chat.filteredNote': ['Showing matches only', 'تُعرض المطابقات فقط'],
  'chat.dropFile': ['Drop to share this file', 'أفلت لمشاركة هذا الملف'],
  'chat.edit': ['Edit message', 'تعديل الرسالة'],
  'chat.delete': ['Delete message', 'حذف الرسالة'],
  'chat.edited': ['edited', 'معدّلة'],
  'chat.editPlaceholder': ['Edit your message…', 'عدّل رسالتك…'],
  'chat.save': ['Save', 'حفظ'],
  'chat.cancel': ['Cancel', 'إلغاء'],
  'chat.deleteConfirm': ['Delete this message?', 'حذف هذه الرسالة؟'],
  'chat.deleted': ['Message deleted.', 'تم حذف الرسالة.'],
  'chat.editFailed': ['Could not edit that message.', 'تعذّر تعديل تلك الرسالة.'],
  'chat.deleteFailed': ['Could not delete that message.', 'تعذّر حذف تلك الرسالة.'],
  'chat.pin': ['Pin message', 'تثبيت الرسالة'],
  'chat.pinned': ['Pinned', 'مثبّتة'],
  'chat.pinFailed': ['Could not pin that message.', 'تعذّر تثبيت تلك الرسالة.'],
  'chat.jumpPinned': ['Jump to pinned message', 'الانتقال إلى الرسالة المثبّتة'],
  'chat.unpin': ['Unpin message', 'إلغاء تثبيت الرسالة'],
  'chat.insertEmoji': ['Insert emoji', 'إدراج إيموجي'],

  'settings.title': ['Display', 'العرض'],
  'settings.textSize': ['Text size', 'حجم النص'],
  'settings.small': ['Small', 'صغير'],
  'settings.normal': ['Normal', 'عادي'],
  'settings.large': ['Large', 'كبير'],
  'settings.density': ['Density', 'الكثافة'],
  'settings.comfortable': ['Comfortable', 'مريح'],
  'settings.compact': ['Compact', 'مدمج'],
  'settings.motion': ['Motion', 'الحركة'],
  'settings.motionOn': ['On', 'مفعّلة'],
  'settings.motionOff': ['Off', 'متوقفة'],
  'settings.speaker': ['Speaker volume', 'مستوى صوت السماعة'],
  'settings.notifications': ['Mention notifications', 'إشعارات المنشن'],
  'settings.notificationsOn': ['Notifications on', 'الإشعارات مفعّلة'],
  'settings.notificationsOff': ['Notifications off', 'الإشعارات متوقفة'],
  'settings.session': ['Session', 'الجلسة'],
  'settings.focus': ['Focus mode', 'وضع التركيز'],
  'settings.focusOn': ['Focus on', 'التركيز مفعّل'],
  'settings.focusOff': ['Focus off', 'التركيز متوقف'],

  'stats.roomsOnline': ['rooms online now', 'غرف متصلة الآن'],
  'stats.uptime': ['server uptime', 'وقت تشغيل الخادم'],
  'stats.pingNow': ['ping right now', 'الاستجابة الآن'],

  'date.today': ['Today', 'اليوم'],
  'date.yesterday': ['Yesterday', 'أمس'],

  'screen.youSharing': ['You are sharing your screen', 'أنت تشارك شاشتك'],
  'screen.someoneSharing': ['{name} is sharing their screen', '{name} يشارك شاشته'],
  'screen.someone': ['Someone', 'شخص ما'],
  'screen.sharingCount': ['{count} sharing', '{count} يشاركون'],
  'screen.switchTitle': [
    'Click to switch between shared screens',
    'انقر للتبديل بين الشاشات المشتركة'
  ],
  'screen.room': ['Room', 'الغرفة'],
  'screen.stageRoom': ['Room {code}', 'الغرفة {code}'],
  'screen.person': ['{count} person', '{count} شخص'],
  'screen.people': ['{count} people', '{count} أشخاص'],

  'control.mute': ['Mute', 'كتم'],
  'control.unmute': ['Unmute', 'إلغاء الكتم'],
  'control.stopVideo': ['Stop video', 'إيقاف الفيديو'],
  'control.camera': ['Camera', 'الكاميرا'],
  'control.stopShare': ['Stop', 'إيقاف'],
  'control.share': ['Share', 'مشاركة'],
  'control.hand': ['Hand', 'يد'],
  'control.react': ['React', 'تفاعل'],
  'control.leave': ['Leave', 'مغادرة'],
  'control.micOnTitle': ['Mute microphone (M)', 'كتم الميكروفون (M)'],
  'control.micOffTitle': ['Unmute microphone (M)', 'إلغاء كتم الميكروفون (M)'],
  'control.cameraOnTitle': ['Turn camera off (V)', 'إيقاف الكاميرا (V)'],
  'control.cameraOffTitle': ['Turn camera on (V)', 'تشغيل الكاميرا (V)'],
  'control.screenOnTitle': ['Stop sharing screen (S)', 'إيقاف مشاركة الشاشة (S)'],
  'control.screenOffTitle': ['Share screen (S)', 'مشاركة الشاشة (S)'],
  'control.handOnTitle': ['Lower hand (H)', 'إنزال اليد (H)'],
  'control.handOffTitle': ['Raise hand (H)', 'رفع اليد (H)'],

  'media.permission': [
    'Permission was blocked. Allow mic or camera access in your browser, then try again.',
    'تم حظر الإذن. اسمح بالوصول إلى الميكروفون أو الكاميرا في متصفحك، ثم حاول مرة أخرى.'
  ],
  'media.notFound': ['No microphone or camera was found on this device.', 'لم يتم العثور على ميكروفون أو كاميرا على هذا الجهاز.'],
  'media.busy': ['Your microphone or camera is busy in another app.', 'الميكروفون أو الكاميرا قيد الاستخدام في تطبيق آخر.'],
  'media.overconstrained': [
    'This device cannot provide the requested camera settings.',
    'لا يمكن لهذا الجهاز توفير إعدادات الكاميرا المطلوبة.'
  ],
  'media.generic': ['Could not start your microphone or camera.', 'تعذّر تشغيل الميكروفون أو الكاميرا.'],
  'media.cameraOnlyWarning': [
    'Camera unavailable — you joined with audio only.',
    'الكاميرا غير متاحة — انضممت بالصوت فقط.'
  ],
  'media.screenUnavailable': [
    'Screen sharing is not available in this browser.',
    'مشاركة الشاشة غير متاحة في هذا المتصفح.'
  ],
  'media.screenStartFailed': ['Screen sharing could not start.', 'تعذّر بدء مشاركة الشاشة.'],
  'media.screenStopped': ['Screen sharing stopped.', 'توقفت مشاركة الشاشة.'],
  'media.micDisconnected': ['Microphone disconnected.', 'انقطع الميكروفون.'],
  'media.cameraDisconnected': ['Camera disconnected.', 'انقطعت الكاميرا.'],
  'media.peerOfferFailed': [
    'A peer connection could not be established.',
    'تعذّر إنشاء اتصال مع أحد المشاركين.'
  ],
  'media.peerAnswerFailed': [
    'A peer connection could not be completed.',
    'تعذّر إكمال الاتصال بأحد المشاركين.'
  ],
  'media.peerFailed': [
    'One peer connection failed. Try leaving and rejoining the room.',
    'فشل اتصال أحد المشاركين. غادر الغرفة ثم انضم مجددًا.'
  ],

  'upload.unsupported': ['That file type is not supported.', 'نوع الملف غير مدعوم.'],
  'upload.tooLarge': ['Files must be 8 MB or smaller.', 'يجب ألا يتجاوز حجم الملف 8 ميغابايت.'],
  'upload.uploading': ['Uploading {name}…', 'جارٍ رفع {name}…'],
  'upload.failed': ['The upload failed. Try again.', 'فشل الرفع. حاول مرة أخرى.'],
  'upload.file': ['File', 'ملف'],
  'upload.download': ['Download', 'تنزيل'],

  'toast.inviteCopied': ['Invite link copied.', 'تم نسخ رابط الدعوة.'],
  'toast.copyFailed': [
    'Copy failed. The room code is on screen.',
    'تعذّر النسخ. رمز الغرفة ظاهر على الشاشة.'
  ],
  'toast.reconnected': ['Reconnected.', 'تمت إعادة الاتصال.'],

  'confirm.leave': ['Leave this room?', 'مغادرة هذه الغرفة؟'],

  'tools.title': ['Room tools', 'أدوات الغرفة'],
  'tools.saveChat': ['Save chat', 'حفظ الدردشة'],
  'tools.sounds': ['Notification sounds', 'أصوات الإشعارات'],
  'tools.soundOn': ['Sounds on', 'الأصوات مفعّلة'],
  'tools.soundOff': ['Sounds off', 'الأصوات متوقفة'],
  'tools.soundsEnabled': ['Notification sounds on.', 'أصوات الإشعارات مفعّلة.'],
  'tools.soundsDisabled': ['Notification sounds off.', 'أصوات الإشعارات متوقفة.'],
  'tools.shortcuts': ['Shortcuts', 'الاختصارات'],
  'tools.searchChat': ['Search chat', 'بحث في الدردشة'],
  'tools.saved': ['Chat transcript saved.', 'تم حفظ نسخة من الدردشة.'],
  'tools.noMessages': ['There are no messages to save yet.', 'لا توجد رسائل لحفظها بعد.'],
  'tools.transcriptHeader': ['Hush — room {code}', 'Hush — الغرفة {code}'],
  'tools.transcriptSavedAt': ['Saved {date}', 'حُفظت في {date}'],
  'tools.micSettings': ['Mic settings', 'إعدادات الميكروفون'],
  'tools.micTitle': ['Mic settings', 'إعدادات الميكروفون'],
  'tools.micLead': [
    'Noise removal runs in your browser (hardware-accelerated), voice effects run on a separate audio thread so the room stays smooth.',
    'تنقية الضوضاء تعمل في متصفحك (مسرّعة بالأجهزة)، ومؤثرات الصوت تعمل على خيط صوتي منفصل حتى تبقى الغرفة سلسة.'
  ],
  'tools.micLevel': ['Input level', 'مستوى الإدخال'],
  'tools.micGateOpen': ['Gate open', 'البوابة مفتوحة'],
  'tools.micGateClosed': ['Gate closed', 'البوابة مغلقة'],
  'tools.micPreset': ['Preset', 'الإعداد المسبق'],
  'tools.micPresetOff': ['Off (raw mic)', 'إيقاف (مايك خام)'],
  'tools.micPresetVoice': ['Voice', 'صوت طبيعي'],
  'tools.micPresetPodcast': ['Podcast', 'بودكاست'],
  'tools.micPresetGaming': ['Gaming / voice chat', 'ألعاب / دردشة صوتية'],
  'tools.micPresetQuiet': ['Quiet room', 'غرفة هادئة'],
  'tools.micAmp': ['Amplification', 'التضخيم'],
  'tools.micAmpValue': ['{value} dB', '{value} د.ب'],
  'tools.micGate': ['Noise gate', 'بوابة الضوضاء'],
  'tools.micGateThreshold': ['Gate threshold', 'عتبة البوابة'],
  'tools.micGateThresholdValue': ['{value} dB', '{value} د.ب'],
  'tools.micDeDistort': ['De-distortion (soft clip)', 'منع التشويش (قصّ ناعم)'],
  'tools.micDeDistortValue': ['{value}%', '{value}٪'],
  'tools.micNoiseSuppression': ['Noise suppression (browser / hardware)', 'تنقية الضوضاء (المتصفح / الأجهزة)'],
  'tools.micEcho': ['Echo cancellation', 'إلغاء الصدى'],
  'tools.micAutoGain': ['Auto gain', 'الكسب التلقائي'],
  'tools.micMonitor': ['Monitor my voice (speakers)', 'مراقبة صوتي (مكبرات الصوت)'],
  'tools.micMonitorWarn': [
    'Use headphones — otherwise your mic will pick up your own voice.',
    'استخدم سماعات — وإلا سيلتقط الميكروفون صوتك نفسه.'
  ],
  'tools.micQuality': ['Processing quality', 'جودة المعالجة'],
  'tools.micQualityAuto': ['Auto (based on CPU)', 'تلقائي (حسب المعالج)'],
  'tools.micQualityPerformance': ['Performance (light CPU)', 'الأداء (معالج خفيف)'],
  'tools.micQualityQuality': ['Quality (full effects)', 'الجودة (مؤثرات كاملة)'],
  'tools.micDevice': ['Microphone', 'الميكروفون'],
  'tools.micDeviceDefault': ['Default microphone', 'الميكروفون الافتراضي'],
  'tools.micReset': ['Reset', 'إعادة تعيين'],
  'tools.micClose': ['Close', 'إغلاق'],
  'tools.micSaved': ['Mic settings saved.', 'تم حفظ إعدادات الميكروفون.'],
  'tools.micOffNote': [
    'Voice effects are off — the raw mic is sent. Native browser noise suppression still applies.',
    'مؤثرات الصوت متوقفة — يُرسل المايك الخام. تنقية المتصفح الأصلية ما تزال مطبقة.'
  ],

  'shortcuts.title': ['Keyboard shortcuts', 'اختصارات لوحة المفاتيح'],
  'shortcuts.close': ['Close', 'إغلاق'],
  'shortcuts.lead': ['Quick keys while you are in a room.', 'مفاتيح سريعة أثناء وجودك في الغرفة.'],
  'shortcuts.mic': ['Mute / unmute microphone', 'كتم / إلغاء كتم الميكروفون'],
  'shortcuts.camera': ['Turn camera on / off', 'تشغيل / إيقاف الكاميرا'],
  'shortcuts.screen': ['Start / stop screen sharing', 'بدء / إيقاف مشاركة الشاشة'],
  'shortcuts.hand': ['Raise / lower your hand', 'رفع / إنزال اليد'],
  'shortcuts.tabs': ['Switch chat and people', 'التبديل بين الدردشة والأشخاص'],
  'shortcuts.search': ['Focus chat search', 'الانتقال إلى البحث في الدردشة'],
  'shortcuts.shortcuts': ['Open this dialog', 'فتح هذه النافذة'],
  'shortcuts.send': ['Send a message', 'إرسال رسالة'],
  'shortcuts.closeDialogs': ['Close dialogs', 'إغلاق النوافذ'],
  'shortcuts.theme': ['Toggle dark / light theme', 'تبديل السمة الداكنة / الفاتحة'],
  'shortcuts.focus': ['Toggle focus mode', 'تبديل وضع التركيز'],
  'shortcuts.ping': ['Refresh ping', 'تحديث الاستجابة'],

  'landing.openRoom': ['Open a room', 'افتح غرفة'],
  'landing.opening': ['Opening…', 'جارٍ الفتح…'],
  'landing.rateLimited': [
    'Too many rooms from this browser. Give it a minute and try again.',
    'عدد كبير من الغرف من هذا المتصفح. انتظر دقيقة وحاول مرة أخرى.'
  ],
  'landing.createFailed': ['Could not open a room. Please try again.', 'تعذّر فتح غرفة. حاول مرة أخرى.'],
  'landing.codeFormat': [
    'Room codes are 4–12 letters or numbers.',
    'رموز الغرفة من 4 إلى 12 حرفًا أو رقمًا.'
  ],

  'admin.host': ['Host', 'المضيف'],
  'admin.youHost': ['You are the host — right-click people for admin actions.', 'أنت المضيف — انقر بزر الفأرة الأيمن على الأشخاص لإجراءات الإدارة.'],
  'admin.kick': ['Kick', 'طرد'],
  'admin.ban': ['Ban', 'حظر'],
  'admin.disconnect': ['Disconnect', 'قطع الاتصال'],
  'admin.transfer': ['Make host', 'جعله المضيف'],
  'admin.deleteAny': ['Delete for everyone', 'حذف للجميع'],
  'admin.unban': ['Unban', 'إلغاء الحظر'],
  'admin.kicked': ['{name} was kicked by {by}.', 'تم طرد {name} بواسطة {by}.'],
  'admin.banned': ['{name} was banned by {by}.', 'تم حظر {name} بواسطة {by}.'],
  'admin.disconnected': ['{name} was disconnected by {by}.', 'تم قطع اتصال {name} بواسطة {by}.'],
  'admin.removedKicked': ['You were kicked from this room.', 'تم طردك من هذه الغرفة.'],
  'admin.removedBanned': ['You were banned from this room.', 'تم حظرك من هذه الغرفة.'],
  'admin.removedDisconnected': ['You were disconnected by the host.', 'تم قطع اتصالك بواسطة المضيف.'],
  'admin.notAdmin': ['Only the host can do that.', 'المضيف وحده يمكنه فعل ذلك.'],
  'admin.banConfirm': ['Ban {name} for {minutes} minutes?', 'حظر {name} لمدة {minutes} دقيقة؟'],
  'admin.kickConfirm': ['Kick {name} out of the room?', 'طرد {name} من الغرفة؟'],
  'admin.isHost': ['Host', 'مضيف'],
  'admin.menuFor': ['Actions for {name}', 'إجراءات لـ {name}'],
  'admin.mute': ['Mute chat (1 min)', 'كتم الدردشة (دقيقة)'],
  'admin.muted': ['{name} was muted by {by} for 1 minute.', 'تم كتم {name} بواسطة {by} لمدة دقيقة.'],
  'admin.youMuted': ['You were muted by the host for 1 minute.', 'تم كتمك بواسطة المضيف لمدة دقيقة.'],

  'error.banned': ['You are banned from this room. Try again later.', 'أنت محظور من هذه الغرفة. حاول لاحقًا.'],
  'error.spam': ['You are sending too fast. Slow down a moment.', 'أنت ترسل بسرعة كبيرة. خفّف قليلًا.'],
  'error.muted': ['You are muted for spamming. Wait a moment.', 'أنت مكتوم بسبب السبام. انتظر لحظة.'],
  'error.duplicateDevice': ['This device is already in the room — the old session was closed.', 'هذا الجهاز موجود مسبقًا في الغرفة — تم إغلاق الجلسة القديمة.'],
  'error.tooManyFromDevice': ['Too many accounts from this device/connection.', 'عدد كبير من الحسابات من هذا الجهاز/الاتصال.'],
  'error.notAdmin': ['Only the host can do that.', 'المضيف وحده يمكنه فعل ذلك.'],
  'error.userNotFound': ['That person is no longer in the room.', 'ذلك الشخص لم يعد في الغرفة.'],
  'error.cannotTargetSelf': ['You cannot target yourself.', 'لا يمكنك استهداف نفسك.'],

  'log.title': ['Log — updates & fixes', 'السجل — التحديثات والإصلاحات'],
  'log.lead': ['The most important updates and fixes, newest first.', 'أهم التحديثات والإصلاحات، الأحدث أولًا.'],
  'log.open': ['Log', 'السجل'],
  'log.close': ['Close', 'إغلاق'],
  'log.loading': ['Loading…', 'جارٍ التحميل…'],
  'log.empty': ['No updates yet.', 'لا توجد تحديثات بعد.'],

  'sound.volume': ['Sound volume', 'مستوى الصوت'],
  'sound.test': ['Test', 'تجربة'],

  'soundboard.title': ['Soundboard', 'لوحة الصوت'],
  'soundboard.open': ['Soundboard', 'لوحة الصوت'],
  'soundboard.close': ['Close soundboard', 'إغلاق لوحة الصوت'],
  'soundboard.volume': ['Soundboard volume', 'مستوى صوت اللوحة'],
  'soundboard.played': ['{name} played {sound}', 'شغّل {name} {sound}'],
  'soundboard.airhorn': ['Airhorn', 'بوق'],
  'soundboard.rimshot': ['Rimshot', 'قرع'],
  'soundboard.applause': ['Applause', 'تصفيق'],
  'soundboard.trombone': ['Sad trombone', 'ترمبون حزين'],
  'soundboard.boing': ['Boing', 'بوينغ'],
  'soundboard.ding': ['Ding', 'جرس'],
  'soundboard.pop': ['Pop', 'فرقعة'],
  'soundboard.fart': ['Fart', 'ضرطة'],
  'soundboard.cat': ['Meow', 'مواء'],
  'soundboard.wow': ['Wow', 'واو'],
  'soundboard.crickets': ['Crickets', 'صراصير'],
  'soundboard.tada': ['Ta-da!', 'تا-دا!'],

  'volume.title': ['Voice volume', 'مستوى صوت الشخص'],
  'volume.for': ['Volume for {name}', 'مستوى الصوت لـ {name}'],
  'volume.reset': ['Reset to 100%', 'إعادة إلى 100٪'],
  'volume.mute': ['Mute', 'كتم'],
  'volume.unmute': ['Unmute', 'إلغاء الكتم'],
  'volume.current': ['{percent}%', '{percent}٪'],
  'volume.hint': ['Right-click a person to change their voice volume.', 'انقر بزر الفأرة الأيمن على شخص لتغيير مستوى صوته.'],

  'deafen.on': ['Deafened (speakers muted)', 'صامت (السماعات مكتومة)'],
  'deafen.off': ['Deafen', 'كتم السماعات'],
  'deafen.hint': ['Mute everyone for you only (D)', 'كتم الجميع لك وحدك (D)'],

  'soundboard.addTitle': ['Add a custom sound for this room', 'أضف صوتًا مخصصًا لهذه الغرفة'],
  'soundboard.addName': ['Sound name', 'اسم الصوت'],
  'soundboard.addFile': ['Audio file', 'ملف صوتي'],
  'soundboard.chooseEmoji': ['Choose emoji', 'اختر إيموجي'],
  'soundboard.add': ['Add', 'إضافة'],
  'soundboard.clearAll': ['Clear all', 'مسح الكل'],
  'soundboard.addNote': ['Audio only, 2 MB max. Custom sounds are deleted completely when the last person leaves this room.', 'صوت فقط، بحد أقصى 2 ميغابايت. تُحذف الأصوات المخصصة كليًا عند مغادرة آخر شخص لهذه الغرفة.'],
  'soundboard.added': ['Custom sound added to this room.', 'أُضيف الصوت المخصص إلى هذه الغرفة.'],
  'soundboard.removed': ['Custom sound removed.', 'أُزيل الصوت المخصص.'],
  'soundboard.cleared': ['All custom sounds cleared.', 'مُسحت كل الأصوات المخصصة.'],
  'soundboard.boardFull': ['This room already has 12 custom sounds.', 'هذه الغرفة لديها 12 صوتًا مخصصًا بالفعل.'],
  'soundboard.invalidFile': ['That file is not a supported audio file (2 MB max).', 'هذا الملف ليس صوتًا مدعومًا (بحد أقصى 2 ميغابايت).'],
  'soundboard.custom': ['Custom', 'مخصص'],
  'soundboard.delete': ['Delete this custom sound', 'حذف هذا الصوت المخصص'],
  'soundboard.uploading': ['Adding sound…', 'جارٍ إضافة الصوت…'],
  'soundboard.emoji.hush': ['Hush', 'همس'],
  'soundboard.emoji.heart': ['Heart', 'قلب'],
  'soundboard.emoji.fire': ['Fire', 'نار'],
  'soundboard.emoji.star': ['Star', 'نجمة']
};
