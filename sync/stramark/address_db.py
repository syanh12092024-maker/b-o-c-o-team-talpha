#!/usr/bin/env python3
"""
Multi-Country Address Database with Fuzzy Matching.

Covers: Romania (RO), Slovakia (SK), Bulgaria (BG), Croatia (HR).
Each country has major cities/towns with ZIP codes, organized by region.
Provides fuzzy matching to auto-correct misspelled city names and fill missing ZIPs.

Usage:
    from address_db import suggest_correction, lookup_city

    result = suggest_correction("RO", "bucuresti", "")
    # → {"city": "București", "zip": "010001", "region": "București", "confidence": 0.95}
"""

import re
import logging
from typing import Optional, Tuple, Dict

log = logging.getLogger("fulfillment.address_db")


# ═══════════════════════════════════════════════════════════════════════════════
# Data Format: "CityName|ZIP|Region"
# ═══════════════════════════════════════════════════════════════════════════════

_RO_DATA = """
# București
București|010001|București
Sector 1|010001|București
Sector 2|020001|București
Sector 3|030001|București
Sector 4|040001|București
Sector 5|050001|București
Sector 6|060001|București
# Ilfov
Voluntari|077190|Ilfov
Popești-Leordeni|077160|Ilfov
Bragadiru|077025|Ilfov
Pantelimon|077145|Ilfov
Chitila|077040|Ilfov
Otopeni|075100|Ilfov
Buftea|070000|Ilfov
Măgurele|077125|Ilfov
# Cluj
Cluj-Napoca|400001|Cluj
Turda|401500|Cluj
Dej|405200|Cluj
Câmpia Turzii|405100|Cluj
Gherla|405300|Cluj
Huedin|405400|Cluj
# Timiș
Timișoara|300001|Timiș
Lugoj|305500|Timiș
Sânnicolau Mare|305600|Timiș
Jimbolia|305400|Timiș
Buziaș|305100|Timiș
Făget|305300|Timiș
Recaș|305500|Timiș
# Iași
Iași|700001|Iași
Pașcani|705200|Iași
Hârlău|705100|Iași
Târgu Frumos|705300|Iași
# Constanța
Constanța|900001|Constanța
Mangalia|905500|Constanța
Medgidia|905600|Constanța
Năvodari|905700|Constanța
Cernavodă|905200|Constanța
Eforie|905360|Constanța
Techirghiol|906100|Constanța
# Brașov
Brașov|500001|Brașov
Săcele|505600|Brașov
Codlea|505100|Brașov
Făgăraș|505200|Brașov
Zărnești|505800|Brașov
Râșnov|505400|Brașov
Victoria|505700|Brașov
Predeal|505300|Brașov
# Prahova
Ploiești|100001|Prahova
Câmpina|105600|Prahova
Băicoi|105200|Prahova
Sinaia|106100|Prahova
Bușteni|105500|Prahova
Azuga|105100|Prahova
Vălenii de Munte|106400|Prahova
# Sibiu
Sibiu|550001|Sibiu
Mediaș|551001|Sibiu
Cisnădie|555300|Sibiu
Avrig|555200|Sibiu
Agnita|555100|Sibiu
Dumbrăveni|555500|Sibiu
Copșa Mică|555400|Sibiu
# Dolj
Craiova|200001|Dolj
Băilești|207040|Dolj
Calafat|205200|Dolj
Filiași|205300|Dolj
# Argeș
Pitești|110001|Argeș
Câmpulung|115100|Argeș
Curtea de Argeș|115300|Argeș
Mioveni|115400|Argeș
Costești|115200|Argeș
# Mureș
Târgu Mureș|540001|Mureș
Reghin|545300|Mureș
Sighișoara|545400|Mureș
Târnăveni|545600|Mureș
Luduș|545200|Mureș
# Galați
Galați|800001|Galați
Tecuci|805300|Galați
Târgu Bujor|805200|Galați
# Bacău
Bacău|600001|Bacău
Onești|601100|Bacău
Moinești|605400|Bacău
Comănești|605200|Bacău
# Hunedoara
Deva|330001|Hunedoara
Hunedoara|331001|Hunedoara
Petroșani|332001|Hunedoara
Lupeni|335600|Hunedoara
Brad|335200|Hunedoara
Orăștie|335700|Hunedoara
Vulcan|336200|Hunedoara
# Suceava
Suceava|720001|Suceava
Fălticeni|725200|Suceava
Rădăuți|725400|Suceava
Câmpulung Moldovenesc|725100|Suceava
Vatra Dornei|725700|Suceava
Gura Humorului|725300|Suceava
# Bihor
Oradea|410001|Bihor
Salonta|415500|Bihor
Beiuș|415200|Bihor
Marghita|415300|Bihor
# Maramureș
Baia Mare|430001|Maramureș
Sighetu Marmației|435500|Maramureș
Borșa|435200|Maramureș
Vișeu de Sus|435700|Maramureș
# Arad
Arad|310001|Arad
Ineu|315300|Arad
Lipova|315400|Arad
Pecica|315500|Arad
# Satu Mare
Satu Mare|440001|Satu Mare
Carei|445100|Satu Mare
Negrești-Oaș|445200|Satu Mare
Tășnad|445300|Satu Mare
# Alba
Alba Iulia|510001|Alba
Sebeș|515800|Alba
Aiud|515200|Alba
Blaj|515400|Alba
Câmpeni|515500|Alba
# Buzău
Buzău|120001|Buzău
Râmnicu Sărat|125300|Buzău
Nehoiu|125200|Buzău
# Vâlcea
Râmnicu Vâlcea|240001|Vâlcea
Drăgășani|245700|Vâlcea
Călimănești|245600|Vâlcea
# Gorj
Târgu Jiu|210001|Gorj
Motru|215200|Gorj
Rovinari|215400|Gorj
# Botoșani
Botoșani|710001|Botoșani
Dorohoi|715200|Botoșani
# Neamț
Piatra Neamț|610001|Neamț
Roman|611001|Neamț
Bicaz|615100|Neamț
# Dâmbovița
Târgoviște|130001|Dâmbovița
Moreni|135300|Dâmbovița
Pucioasa|135400|Dâmbovița
# Teleorman
Alexandria|140001|Teleorman
Roșiori de Vede|145100|Teleorman
Turnu Măgurele|145200|Teleorman
# Olt
Slatina|230001|Olt
Caracal|235200|Olt
Scornicești|235500|Olt
# Vrancea
Focșani|620001|Vrancea
Adjud|625100|Vrancea
# Vaslui
Vaslui|730001|Vaslui
Bârlad|731100|Vaslui
Huși|735100|Vaslui
# Mehedinți
Drobeta-Turnu Severin|220001|Mehedinți
Orșova|225200|Mehedinți
# Caraș-Severin
Reșița|320001|Caraș-Severin
Caransebeș|325100|Caraș-Severin
Anina|325100|Caraș-Severin
# Bistrița-Năsăud
Bistrița|420001|Bistrița-Năsăud
Năsăud|425200|Bistrița-Năsăud
# Sălaj
Zalău|450001|Sălaj
Șimleu Silvaniei|455300|Sălaj
# Covasna
Sfântu Gheorghe|520001|Covasna
Târgu Secuiesc|525400|Covasna
# Harghita
Miercurea Ciuc|530001|Harghita
Odorheiu Secuiesc|535600|Harghita
Toplița|535700|Harghita
Gheorgheni|535500|Harghita
# Giurgiu
Giurgiu|080001|Giurgiu
# Ialomița
Slobozia|920001|Ialomița
Fetești|925100|Ialomița
Urziceni|925300|Ialomița
# Călărași
Călărași|910001|Călărași
Oltenița|915400|Călărași
"""

_SK_DATA = """
# Bratislavský kraj
Bratislava|811 01|Bratislavský
Malacky|901 01|Bratislavský
Pezinok|902 01|Bratislavský
Senec|903 01|Bratislavský
Modra|900 01|Bratislavský
Stupava|900 31|Bratislavský
Šamorín|931 01|Bratislavský
Dunajská Streda|929 01|Bratislavský
# Trnavský kraj
Trnava|917 01|Trnavský
Piešťany|921 01|Trnavský
Hlohovec|920 01|Trnavský
Galanta|924 01|Trnavský
Skalica|909 01|Trnavský
Senica|905 01|Trnavský
Sereď|926 01|Trnavský
Holíč|908 51|Trnavský
# Trenčiansky kraj
Trenčín|911 01|Trenčiansky
Považská Bystrica|017 01|Trenčiansky
Púchov|020 01|Trenčiansky
Partizánske|958 01|Trenčiansky
Nové Mesto nad Váhom|915 01|Trenčiansky
Dubnica nad Váhom|018 41|Trenčiansky
Ilava|019 01|Trenčiansky
Bánovce nad Bebravou|957 01|Trenčiansky
Myjava|907 01|Trenčiansky
Handlová|972 51|Trenčiansky
# Nitriansky kraj
Nitra|949 01|Nitriansky
Komárno|945 01|Nitriansky
Nové Zámky|940 01|Nitriansky
Levice|934 01|Nitriansky
Šaľa|927 01|Nitriansky
Topoľčany|955 01|Nitriansky
Zlaté Moravce|953 01|Nitriansky
Štúrovo|943 01|Nitriansky
# Žilinský kraj
Žilina|010 01|Žilinský
Martin|036 01|Žilinský
Ružomberok|034 01|Žilinský
Liptovský Mikuláš|031 01|Žilinský
Čadca|022 01|Žilinský
Dolný Kubín|026 01|Žilinský
Námestovo|029 01|Žilinský
Bytča|014 01|Žilinský
# Banskobystrický kraj
Banská Bystrica|974 01|Banskobystrický
Zvolen|960 01|Banskobystrický
Lučenec|984 01|Banskobystrický
Rimavská Sobota|979 01|Banskobystrický
Žiar nad Hronom|965 01|Banskobystrický
Brezno|977 01|Banskobystrický
Banská Štiavnica|969 01|Banskobystrický
# Prešovský kraj
Prešov|080 01|Prešovský
Poprad|058 01|Prešovský
Humenné|066 01|Prešovský
Bardejov|085 01|Prešovský
Vranov nad Topľou|093 01|Prešovský
Kežmarok|060 01|Prešovský
Stará Ľubovňa|064 01|Prešovský
Levoča|054 01|Prešovský
Spišská Nová Ves|052 01|Prešovský
Vysoké Tatry|062 01|Prešovský
# Košický kraj
Košice|040 01|Košický
Michalovce|071 01|Košický
Trebišov|075 01|Košický
Rožňava|048 01|Košický
Gelnica|056 01|Košický
Moldava nad Bodvou|045 01|Košický
Sobrance|073 01|Košický
"""

_BG_DATA = """
# София-град
София|1000|София-град
# Пловдив
Пловдив|4000|Пловдив
Асеновград|4230|Пловдив
Карлово|4300|Пловдив
Сопот|4330|Пловдив
Хисаря|4180|Пловдив
Plovdiv|4000|Пловдив
# Варна
Варна|9000|Варна
Девня|9160|Варна
Провадия|9200|Варна
Varna|9000|Варна
# Бургас
Бургас|8000|Бургас
Несебър|8230|Бургас
Поморие|8200|Бургас
Созопол|8130|Бургас
Приморско|8180|Бургас
Burgas|8000|Бургас
# Русе
Русе|7000|Русе
Ruse|7000|Русе
# Стара Загора
Стара Загора|6000|Стара Загора
Казанлък|6100|Стара Загора
Чирпан|6200|Стара Загора
Stara Zagora|6000|Стара Загора
# Плевен
Плевен|5800|Плевен
Ловеч|5500|Плевен
Pleven|5800|Плевен
# Велико Търново
Велико Търново|5000|Велико Търново
Свищов|5250|Велико Търново
Горна Оряховица|5100|Велико Търново
Veliko Tarnovo|5000|Велико Търново
# Благоевград
Благоевград|2700|Благоевград
Петрич|2850|Благоевград
Сандански|2800|Благоевград
Банско|2770|Благоевград
Разлог|2760|Благоевград
Blagoevgrad|2700|Благоевград
# Добрич
Добрич|9300|Добрич
Балчик|9600|Добрич
Каварна|9650|Добрич
Dobrich|9300|Добрич
# Шумен
Шумен|9700|Шумен
Shumen|9700|Шумен
# Хасково
Хасково|6300|Хасково
Димитровград|6400|Хасково
Свиленград|6500|Хасково
Haskovo|6300|Хасково
# Пазарджик
Пазарджик|4400|Пазарджик
Велинград|4600|Пазарджик
Пещера|4550|Пазарджик
Pazardzhik|4400|Пазарджик
# Сливен
Сливен|8800|Сливен
Нова Загора|8900|Сливен
Sliven|8800|Сливен
# Ямбол
Ямбол|8600|Ямбол
Елхово|8700|Ямбол
Yambol|8600|Ямбол
# Перник
Перник|2300|Перник
Pernik|2300|Перник
# Кюстендил
Кюстендил|2500|Кюстендил
Дупница|2600|Кюстендил
Kyustendil|2500|Кюстендил
# Враца
Враца|3000|Враца
Vratsa|3000|Враца
# Монтана
Монтана|3400|Монтана
Montana|3400|Монтана
# Видин
Видин|3700|Видин
Vidin|3700|Видин
# Габрово
Габрово|5300|Габрово
Севлиево|5400|Габрово
Gabrovo|5300|Габрово
# Търговище
Търговище|7700|Търговище
Targovishte|7700|Търговище
# Разград
Разград|7200|Разград
Razgrad|7200|Разград
# Силистра
Силистра|7500|Силистра
Silistra|7500|Силистра
# Смолян
Смолян|4700|Смолян
Smolyan|4700|Смолян
# Sofia (latin alias)
Sofia|1000|София-град
"""

_HR_DATA = """
# Zagreb
Zagreb|10000|Grad Zagreb
Velika Gorica|10410|Zagrebačka
Zaprešić|10290|Zagrebačka
Samobor|10430|Zagrebačka
Dugo Selo|10370|Zagrebačka
Sveta Nedelja|10431|Zagrebačka
Jastrebarsko|10450|Zagrebačka
Vrbovec|10340|Zagrebačka
# Split-Dalmatia
Split|21000|Splitsko-dalmatinska
Solin|21210|Splitsko-dalmatinska
Kaštela|21212|Splitsko-dalmatinska
Sinj|21230|Splitsko-dalmatinska
Trogir|21220|Splitsko-dalmatinska
Omiš|21310|Splitsko-dalmatinska
Makarska|21300|Splitsko-dalmatinska
Imotski|21260|Splitsko-dalmatinska
# Rijeka / Primorje-Gorski Kotar
Rijeka|51000|Primorsko-goranska
Opatija|51410|Primorsko-goranska
Crikvenica|51260|Primorsko-goranska
Krk|51500|Primorsko-goranska
Delnice|51300|Primorsko-goranska
Mali Lošinj|51550|Primorsko-goranska
# Osijek-Baranja
Osijek|31000|Osječko-baranjska
Đakovo|31400|Osječko-baranjska
Beli Manastir|31300|Osječko-baranjska
Valpovo|31550|Osječko-baranjska
Našice|31500|Osječko-baranjska
Belišće|31551|Osječko-baranjska
# Zadar
Zadar|23000|Zadarska
Biograd na Moru|23210|Zadarska
Benkovac|23420|Zadarska
Nin|23232|Zadarska
Pag|23250|Zadarska
# Dubrovnik-Neretva
Dubrovnik|20000|Dubrovačko-neretvanska
Metković|20350|Dubrovačko-neretvanska
Ploče|20340|Dubrovačko-neretvanska
Korčula|20260|Dubrovačko-neretvanska
# Istria
Pula|52100|Istarska
Rovinj|52210|Istarska
Poreč|52440|Istarska
Umag|52470|Istarska
Pazin|52000|Istarska
Labin|52220|Istarska
Buzet|52420|Istarska
# Varaždin
Varaždin|42000|Varaždinska
Ivanec|42240|Varaždinska
Ludbreg|42230|Varaždinska
Novi Marof|42220|Varaždinska
# Slavonski Brod-Posavina
Slavonski Brod|35000|Brodsko-posavska
Nova Gradiška|35400|Brodsko-posavska
# Karlovac
Karlovac|47000|Karlovačka
Ogulin|47300|Karlovačka
Duga Resa|47250|Karlovačka
Slunj|47240|Karlovačka
# Sisak-Moslavina
Sisak|44000|Sisačko-moslavačka
Kutina|44320|Sisačko-moslavačka
Petrinja|44250|Sisačko-moslavačka
Novska|44330|Sisačko-moslavačka
# Koprivnica-Križevci
Koprivnica|48000|Koprivničko-križevačka
Križevci|48260|Koprivničko-križevačka
Đurđevac|48350|Koprivničko-križevačka
# Vukovar-Srijem
Vukovar|32000|Vukovarsko-srijemska
Vinkovci|32100|Vukovarsko-srijemska
Županja|32270|Vukovarsko-srijemska
Ilok|32236|Vukovarsko-srijemska
# Požega-Slavonia
Požega|34000|Požeško-slavonska
Pakrac|34550|Požeško-slavonska
# Šibenik-Knin
Šibenik|22000|Šibensko-kninska
Knin|22300|Šibensko-kninska
Drniš|22320|Šibensko-kninska
# Bjelovar-Bilogora
Bjelovar|43000|Bjelovarsko-bilogorska
Čazma|43240|Bjelovarsko-bilogorska
Daruvar|43500|Bjelovarsko-bilogorska
Garešnica|43280|Bjelovarsko-bilogorska
# Virovitica-Podravina
Virovitica|33000|Virovitičko-podravska
Slatina|33520|Virovitičko-podravska
Orahovica|33515|Virovitičko-podravska
# Lika-Senj
Gospić|53000|Ličko-senjska
Senj|53270|Ličko-senjska
Otočac|53220|Ličko-senjska
# Međimurje
Čakovec|40000|Međimurska
Prelog|40323|Međimurska
Mursko Središće|40315|Međimurska
# Krapina-Zagorje
Krapina|49000|Krapinsko-zagorska
Zabok|49210|Krapinsko-zagorska
Pregrada|49218|Krapinsko-zagorska
Zlatar|49250|Krapinsko-zagorska
"""

# ═══════════════════════════════════════════════════════════════════════════════
# Common aliases / misspellings per country
# ═══════════════════════════════════════════════════════════════════════════════

_RO_ALIASES = {
    "bucuresti": "bucurești", "bucharest": "bucurești",
    "cluj napoca": "cluj-napoca", "cluj": "cluj-napoca",
    "timisoara": "timișoara", "iasi": "iași",
    "constanta": "constanța", "brasov": "brașov",
    "craiova": "craiova", "ploiesti": "ploiești",
    "oradea": "oradea", "arad": "arad",
    "pitesti": "pitești", "sibiu": "sibiu",
    "bacau": "bacău", "targu mures": "târgu mureș",
    "baia mare": "baia mare", "buzau": "buzău",
    "satu mare": "satu mare", "botosani": "botoșani",
    "ramnicu valcea": "râmnicu vâlcea", "suceava": "suceava",
    "piatra neamt": "piatra neamț", "deva": "deva",
    "targoviste": "târgoviște", "targu jiu": "târgu jiu",
    "focsani": "focșani", "galati": "galați",
    "alba iulia": "alba iulia", "zalau": "zalău",
    "sfantu gheorghe": "sfântu gheorghe", "miercurea ciuc": "miercurea ciuc",
    "bistrita": "bistrița", "resita": "reșița",
    "slatina": "slatina", "alexandria": "alexandria",
    "slobozia": "slobozia", "calarasi": "călărași",
    "giurgiu": "giurgiu", "vaslui": "vaslui",
    "drobeta turnu severin": "drobeta-turnu severin",
    "drobeta": "drobeta-turnu severin",
    "ramnicu sarat": "râmnicu sărat",
    "campina": "câmpina", "sinaia": "sinaia",
    "predeal": "predeal", "busteni": "bușteni",
    "mediaș": "mediaș", "medias": "mediaș",
    "sighisoara": "sighișoara", "lugoj": "lugoj",
    "hunedoara": "hunedoara", "petrosani": "petroșani",
    "onesti": "onești", "roman": "roman",
    "tecuci": "tecuci", "barlad": "bârlad",
    "husi": "huși", "falticeni": "fălticeni",
    "radauti": "rădăuți", "voluntari": "voluntari",
    "popesti leordeni": "popești-leordeni",
    "popesti-leordeni": "popești-leordeni",
}

_SK_ALIASES = {
    "ba": "bratislava", "ke": "košice", "bb": "banská bystrica",
    "nr": "nitra", "za": "žilina", "po": "prešov",
    "tn": "trenčín", "tt": "trnava",
    "presov": "prešov", "kosice": "košice", "zilina": "žilina",
    "trencin": "trenčín", "banska bystrica": "banská bystrica",
    "piestany": "piešťany", "nove zamky": "nové zámky",
    "ruzomberok": "ružomberok", "sturovo": "štúrovo",
    "liptovsky mikulas": "liptovský mikuláš",
    "banska stiavnica": "banská štiavnica",
    "spisska nova ves": "spišská nová ves",
    "stara lubovna": "stará ľubovňa",
    "cadca": "čadca", "dolny kubin": "dolný kubín",
    "namestovo": "námestovo", "lucenec": "lučenec",
    "rimavska sobota": "rimavská sobota",
    "povazska bystrica": "považská bystrica",
    "nove mesto nad vahom": "nové mesto nad váhom",
    "dubnica nad vahom": "dubnica nad váhom",
    "ziar nad hronom": "žiar nad hronom",
    "vysoke tatry": "vysoké tatry",
    "dunajska streda": "dunajská streda",
    "kezmarok": "kežmarok", "levoca": "levoča",
    "humenne": "humenné", "bardejov": "bardejov",
    "vranov nad toplou": "vranov nad topľou",
    "michalovce": "michalovce", "trebisov": "trebišov",
    "roznava": "rožňava", "komarno": "komárno",
    "sala": "šaľa", "topolcany": "topoľčany",
    "partizanske": "partizánske", "puchov": "púchov",
    "handlova": "handlová", "svidnik": "svidník",
    "moldava nad bodvou": "moldava nad bodvou",
    "zlaté moravce": "zlaté moravce", "galanta": "galanta",
}

_BG_ALIASES = {
    # Latin→Latin aliases (euShipments accepts both Latin and Cyrillic)
    "kazanlak": "казанлък", "kazanluk": "казанлък",
    "asenovgrad": "асеновград",
    "nessebar": "несебър", "nesebar": "несебър",
    "pomorie": "поморие", "sozopol": "созопол",
    "velingrad": "велинград", "dupnitsa": "дупница",
    "dupnica": "дупница", "petrich": "петрич",
    "dimitrovgrad": "димитровград", "svilengrad": "свиленград",
    "sevlievo": "севлиево", "gorna oryahovitsa": "горна оряховица",
    "svishtov": "свищов", "lovech": "ловеч",
    "karlovo": "карлово", "sopot": "сопот",
    "nova zagora": "нова загора", "chirpan": "чирпан",
    "sandanski": "сандански", "bansko": "банско",
    # Cyrillic→Cyrillic aliases for common Cyrillic misspellings
    "софія": "софия", "пловдів": "пловдив",
}

_HR_ALIASES = {
    "zg": "zagreb", "st": "split", "ri": "rijeka",
    "os": "osijek", "zd": "zadar", "du": "dubrovnik",
    "pu": "pula",
    "slavonski brod": "slavonski brod",
    "velika gorica": "velika gorica",
    "zapresic": "zaprešić", "karlovac": "karlovac",
    "varazdin": "varaždin", "sisak": "sisak",
    "koprivnica": "koprivnica", "bjelovar": "bjelovar",
    "cakovec": "čakovec", "vukovar": "vukovar",
    "vinkovci": "vinkovci", "pozega": "požega",
    "sibenik": "šibenik", "knin": "knin",
    "gospic": "gospić", "virovitica": "virovitica",
    "krapina": "krapina", "imotski": "imotski",
    "makarska": "makarska", "trogir": "trogir",
    "omis": "omiš", "sinj": "sinj",
    "dakovo": "đakovo", "djakovo": "đakovo",
    "nasice": "našice", "biograd": "biograd na moru",
    "rovinj": "rovinj", "porec": "poreč",
    "umag": "umag", "labin": "labin",
    "opatija": "opatija", "ogulin": "ogulin",
    "kutina": "kutina", "nova gradiska": "nova gradiška",
    "zupanja": "županja",
}


# ═══════════════════════════════════════════════════════════════════════════════
# Parse all databases
# ═══════════════════════════════════════════════════════════════════════════════

# Format: COUNTRY_DB[country_code] = {"city_lower": ("City", "ZIP", "Region")}
COUNTRY_DB: Dict[str, Dict[str, Tuple[str, str, str]]] = {}
COUNTRY_ZIP_DB: Dict[str, Dict[str, Tuple[str, str]]] = {}
COUNTRY_ALIASES: Dict[str, Dict[str, str]] = {
    "RO": _RO_ALIASES, "SK": _SK_ALIASES,
    "BG": _BG_ALIASES, "HR": _HR_ALIASES,
}


def _parse_db(raw_data: str) -> Tuple[dict, dict]:
    cities = {}
    zips = {}
    for line in raw_data.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) == 3:
            city, zip_code, region = parts[0].strip(), parts[1].strip(), parts[2].strip()
            cities[city.lower()] = (city, zip_code, region)
            zn = zip_code.replace(" ", "")
            if zn not in zips:
                zips[zn] = (city, zip_code)
    return cities, zips


for _code, _data in [("RO", _RO_DATA), ("SK", _SK_DATA), ("BG", _BG_DATA), ("HR", _HR_DATA)]:
    _cities, _zips = _parse_db(_data)
    COUNTRY_DB[_code] = _cities
    COUNTRY_ZIP_DB[_code] = _zips


# ═══════════════════════════════════════════════════════════════════════════════
# Fuzzy Matching (shared across all countries)
# ═══════════════════════════════════════════════════════════════════════════════

_DIACRITICS = {
    # Romanian
    "ă": "a", "â": "a", "î": "i", "ș": "s", "ț": "t",
    # Slovak
    "á": "a", "ä": "a", "č": "c", "ď": "d", "é": "e", "í": "i",
    "ĺ": "l", "ľ": "l", "ň": "n", "ó": "o", "ô": "o", "ŕ": "r",
    "š": "s", "ť": "t", "ú": "u", "ý": "y", "ž": "z",
    # Croatian
    "ć": "c", "đ": "d",
    # Bulgarian (Cyrillic→Latin transliteration for fuzzy matching)
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l",
    "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s",
    "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch",
    "ш": "sh", "щ": "sht", "ъ": "a", "ь": "", "ю": "yu", "я": "ya",
}


def _normalize(text: str) -> str:
    """Remove diacritics/transliterate for fuzzy matching."""
    result = text.lower()
    for fr, to in _DIACRITICS.items():
        result = result.replace(fr, to)
    return result


def _levenshtein(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (c1 != c2)))
        prev = curr
    return prev[len(s2)]


def _similarity(s1: str, s2: str) -> float:
    a = _normalize(s1.strip())
    b = _normalize(s2.strip())
    if a == b:
        return 1.0
    m = max(len(a), len(b))
    if m == 0:
        return 1.0
    return 1.0 - (_levenshtein(a, b) / m)


# ═══════════════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════════════

def lookup_city(country_code: str, name: str) -> Optional[Tuple[str, str, str, float]]:
    """
    Look up city in country database.
    Returns: (correct_city, zip_code, region, confidence) or None.
    """
    if not name or not name.strip():
        return None

    cc = country_code.upper()
    db = COUNTRY_DB.get(cc, {})
    aliases = COUNTRY_ALIASES.get(cc, {})
    clean = name.strip().lower()

    # 1. Exact match
    if clean in db:
        city, z, r = db[clean]
        return (city, z, r, 1.0)

    # 2. Alias match
    if clean in aliases:
        target = aliases[clean]
        if target in db:
            city, z, r = db[target]
            return (city, z, r, 0.95)

    # 3. Normalized (no diacritics) match
    clean_n = _normalize(clean)
    for key, (city, z, r) in db.items():
        if _normalize(key) == clean_n:
            return (city, z, r, 0.95)

    # 4. Alias with normalization
    for alias, target in aliases.items():
        if _normalize(alias) == clean_n and target in db:
            city, z, r = db[target]
            return (city, z, r, 0.92)

    # 5. Fuzzy match
    best = None
    best_score = 0.0
    for key, (city, z, r) in db.items():
        score = _similarity(clean, key)
        if score > best_score:
            best_score = score
            best = (city, z, r, score)

    if best and best_score >= 0.7:
        return best

    return None


def lookup_zip(country_code: str, zip_code: str) -> Optional[Tuple[str, str]]:
    """Look up ZIP → city. Returns (city, formatted_zip) or None."""
    if not zip_code:
        return None
    cc = country_code.upper()
    zdb = COUNTRY_ZIP_DB.get(cc, {})
    normalized = zip_code.strip().replace(" ", "")
    return zdb.get(normalized)


def suggest_correction(country_code: str, city: str, zip_code: str) -> dict:
    """
    Suggest corrections for city/ZIP. Works for any supported country.

    Returns dict with keys: city, zip, region, confidence, source.
    """
    corrections = {}
    cc = country_code.upper()

    # Strategy 1: lookup by city
    if city:
        result = lookup_city(cc, city)
        if result:
            correct_city, correct_zip, region, conf = result
            corrections["city"] = correct_city
            corrections["region"] = region
            corrections["confidence"] = conf

            if not zip_code:
                corrections["zip"] = correct_zip
                corrections["source"] = "city->zip"
            elif zip_code.replace(" ", "") != correct_zip.replace(" ", ""):
                corrections["zip"] = correct_zip
                corrections["source"] = "city->zip (mismatch)"
            else:
                corrections["source"] = "city_match"

    # Strategy 2: lookup by ZIP
    if zip_code and "city" not in corrections:
        result = lookup_zip(cc, zip_code)
        if result:
            correct_city, correct_zip = result
            corrections["city"] = correct_city
            corrections["zip"] = correct_zip
            corrections["confidence"] = 0.9
            corrections["source"] = "zip->city"

    return corrections


def format_zip(country_code: str, zip_code: str) -> str:
    """Format ZIP code per country convention."""
    cc = country_code.upper()
    cleaned = zip_code.strip().replace(" ", "")

    if cc == "SK" and len(cleaned) == 5 and cleaned.isdigit():
        return f"{cleaned[:3]} {cleaned[3:]}"
    # RO, BG, HR: no spaces needed
    return cleaned


def get_city_count(country_code: str) -> int:
    """Return number of cities in database for given country."""
    return len(COUNTRY_DB.get(country_code.upper(), {}))
