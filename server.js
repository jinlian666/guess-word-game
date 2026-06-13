const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 初始化数据库
const db = new sqlite3.Database('./game.db', (err) => {
    if (err) console.error('Database error:', err);
    console.log('Connected to SQLite database');
});

// 创建用户表
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 创建猜词记录表
db.run(`CREATE TABLE IF NOT EXISTS guess_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    word TEXT,
    guess TEXT,
    similarity INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
)`);

// 密码加密
function hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
}

// 注册接口
app.post('/api/register', (req, res) => {
    const { username, password, nickname } = req.body;
    const hashedPassword = hashPassword(password);
    
    db.run('INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)', 
        [username, hashedPassword, nickname], 
        function(err) {
            if (err) {
                return res.json({ success: false, message: '用户名已存在' });
            }
            res.json({ success: true, userId: this.lastID, nickname });
        });
});

// 登录接口
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = hashPassword(password);
    
    db.get('SELECT id, nickname, score, is_admin FROM users WHERE username = ? AND password = ?', 
        [username, hashedPassword], 
        (err, user) => {
            if (err || !user) {
                return res.json({ success: false, message: '用户名或密码错误' });
            }
            res.json({ success: true, user });
        });
});

// 获取排行榜
app.get('/api/leaderboard', (req, res) => {
    db.all('SELECT id, nickname, score FROM users WHERE score > 0 ORDER BY score DESC LIMIT 20', 
        (err, rows) => {
            res.json({ success: true, list: rows || [] });
        });
});

// 更新分数
app.post('/api/update-score', (req, res) => {
    const { userId, addScore } = req.body;
    db.run('UPDATE users SET score = score + ? WHERE id = ?', [addScore, userId], (err) => {
        if (err) return res.json({ success: false });
        db.get('SELECT score FROM users WHERE id = ?', [userId], (err, user) => {
            res.json({ success: true, newScore: user.score });
        });
    });
});

// 智能相关度计算（备用算法）
function calculateSimilarity(word, guess, category) {
    word = word.toLowerCase();
    guess = guess.toLowerCase();
    
    if (word === guess) return 100;
    
    // 高相关关键词
    const highRelated = {
        '自然': ['天空', '大地', '山', '水', '风', '雨', '云', '太阳', '月亮', '星星', '树', '花', '草', '森林', '海洋', '河流', '天气', '季节'],
        '动物': ['狗', '猫', '鸟', '鱼', '虫', '兽', '宠物', '野生', '动物园', '羽毛', '翅膀', '尾巴', '爪子'],
        '物品': ['桌子', '椅子', '杯子', '手机', '电脑', '书', '笔', '衣服', '鞋子', '工具', '家具', '电器'],
        '人物': ['爸爸', '妈妈', '老师', '学生', '医生', '警察', '朋友', '家人', '男人', '女人', '孩子', '老人'],
        '抽象': ['爱', '快乐', '悲伤', '时间', '梦想', '希望', '自由', '幸福', '勇敢', '智慧', '美丽', '善良']
    };
    
    // 中相关关键词
    const midRelated = {
        '自然': ['绿色', '蓝色', '白色', '空气', '泥土', '石头', '叶子', '种子'],
        '动物': ['可爱', '凶猛', '温顺', '奔跑', '飞翔', '游泳', '食物'],
        '物品': ['使用', '购买', '价格', '质量', '颜色', '大小', '形状'],
        '人物': ['工作', '学习', '生活', '说话', '走路', '吃饭', '睡觉'],
        '抽象': ['感觉', '想法', '心情', '思想', '精神', '心灵', '人生']
    };
    
    const categoryWords = highRelated[category] || [];
    const midWords = midRelated[category] || [];
    
    // 检查高相关
    for (let w of categoryWords) {
        if (guess.includes(w) || w.includes(guess)) {
            return 50 + Math.floor(Math.random() * 20); // 50-69
        }
    }
    
    // 检查中相关
    for (let w of midWords) {
        if (guess.includes(w) || w.includes(guess)) {
            return 30 + Math.floor(Math.random() * 15); // 30-44
        }
    }
    
    // 包含目标词的字
    let commonChars = 0;
    for (let c of guess) {
        if (word.includes(c)) commonChars++;
    }
    if (commonChars >= 2) {
        return 25 + Math.floor(Math.random() * 15); // 25-39
    }
    
    // 完全不相关
    return 5 + Math.floor(Math.random() * 20); // 5-25
}

// 相关度计算接口
app.post('/api/calc-similarity', async (req, res) => {
    const { word, guess, category } = req.body;
    
    try {
        // 这里可以接入真实大模型API
        // 目前使用优化的备用算法
        const similarity = calculateSimilarity(word, guess, category);
        res.json({ success: true, similarity });
    } catch (e) {
        // 出错时使用备用算法
        const similarity = calculateSimilarity(word, guess, category);
        res.json({ success: true, similarity });
    }
});

// 段位计算
function getRank(score) {
    if (score < 2) return { name: '青铜Ⅲ', color: '#CD7F32' };
    if (score < 4) return { name: '青铜Ⅱ', color: '#CD7F32' };
    if (score < 6) return { name: '青铜Ⅰ', color: '#CD7F32' };
    if (score < 9) return { name: '白银Ⅲ', color: '#C0C0C0' };
    if (score < 12) return { name: '白银Ⅱ', color: '#C0C0C0' };
    if (score < 16) return { name: '白银Ⅰ', color: '#C0C0C0' };
    if (score < 21) return { name: '黄金Ⅲ', color: '#FFD700' };
    if (score < 26) return { name: '黄金Ⅱ', color: '#FFD700' };
    if (score < 31) return { name: '黄金Ⅰ', color: '#FFD700' };
    if (score < 41) return { name: '钻石Ⅲ', color: '#B9F2FF' };
    if (score < 51) return { name: '钻石Ⅱ', color: '#B9F2FF' };
    return { name: '钻石Ⅰ', color: '#B9F2FF' };
}

app.get('/api/rank/:score', (req, res) => {
    res.json(getRank(parseInt(req.params.score) || 0));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./guess_game.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nickname TEXT NOT NULL,
        score INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS game_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        target_word TEXT NOT NULL,
        category TEXT NOT NULL,
        guessed_word TEXT NOT NULL,
        similarity INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        name TEXT NOT NULL
    )`);
});

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

const wordDatabase = {
    '自然': ['太阳', '月亮', '星星', '云朵', '彩虹', '雨水', '雪花', '雷电', '风', '山', '海', '河', '湖', '森林', '沙漠', '草原', '瀑布', '火山', '地震', '海啸'],
    '动物': ['老虎', '狮子', '大象', '熊猫', '猴子', '狗', '猫', '马', '牛', '羊', '鸡', '鸭', '鱼', '鸟', '蛇', '龙', '凤凰', '独角兽', '恐龙', '鲸鱼'],
    '物品': ['手机', '电脑', '电视', '冰箱', '空调', '洗衣机', '汽车', '飞机', '火车', '自行车', '手表', '眼镜', '钥匙', '钱包', '杯子', '筷子', '碗', '盘子', '刀', '笔'],
    '人物': ['爸爸', '妈妈', '爷爷', '奶奶', '老师', '医生', '警察', '消防员', '厨师', '司机', '歌手', '演员', '画家', '作家', '科学家', '宇航员', '运动员', '老板', '员工', '朋友'],
    '抽象': ['爱情', '友情', '亲情', '幸福', '快乐', '悲伤', '愤怒', '害怕', '希望', '梦想', '时间', '生命', '死亡', '自由', '正义', '和平', '美丽', '丑陋', '聪明', '勇敢']
};

function getRandomWord() {
    const categories = Object.keys(wordDatabase);
    const category = categories[Math.floor(Math.random() * categories.length)];
    const words = wordDatabase[category];
    const word = words[Math.floor(Math.random() * words.length)];
    return { word, category };
}

function calculateSimilarityFallback(guess, target, category) {
    const guessLower = guess.toLowerCase();
    const targetLower = target.toLowerCase();
    
    if (guessLower === targetLower) return 100;
    
    const keywords = {
        '自然': {
            high: ['天空', '天气', '大地', '自然', '环境'],
            medium: ['光', '水', '土', '火', '气', '云', '雨', '风', '山', '海']
        },
        '动物': {
            high: ['动物', '生物', '宠物', '野兽', '鸟类', '鱼类'],
            medium: ['毛', '尾巴', '翅膀', '脚', '眼睛', '嘴']
        },
        '物品': {
            high: ['东西', '物品', '工具', '电器', '家具', '交通工具'],
            medium: ['用', '拿', '放', '看', '听', '写']
        },
        '人物': {
            high: ['人', '人物', '职业', '身份', '家人', '角色'],
            medium: ['男', '女', '老', '少', '工作', '做事']
        },
        '抽象': {
            high: ['感情', '感觉', '情绪', '思想', '概念', '精神'],
            medium: ['心', '想', '感觉', '心情', '状态']
        }
    };
    
    const catKeywords = keywords[category] || keywords['物品'];
    
    for (const kw of catKeywords.high) {
        if (guessLower.includes(kw) || kw.includes(guessLower)) {
            return 50 + Math.floor(Math.random() * 20);
        }
    }
    
    for (const kw of catKeywords.medium) {
        if (guessLower.includes(kw) || kw.includes(guessLower)) {
            return 30 + Math.floor(Math.random() * 15);
        }
    }
    
    let commonChars = 0;
    for (const char of guessLower) {
        if (targetLower.includes(char)) commonChars++;
    }
    
    if (commonChars > 0) {
        return 15 + Math.floor(Math.random() * 15);
    }
    
    return 5 + Math.floor(Math.random() * 20);
}

app.post('/api/register', (req, res) => {
    const { username, password, nickname } = req.body;
    
    if (!username || !password || !nickname) {
        return res.json({ success: false, message: '请填写完整信息' });
    }
    
    const hashedPassword = hashPassword(password);
    
    db.run('INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)', 
        [username, hashedPassword, nickname], 
        function(err) {
            if (err) {
                return res.json({ success: false, message: '用户名已存在' });
            }
            res.json({ success: true, userId: this.lastID, nickname });
        });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.json({ success: false, message: '请填写完整信息' });
    }
    
    const hashedPassword = hashPassword(password);
    
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', 
        [username, hashedPassword], 
        (err, user) => {
            if (err || !user) {
                return res.json({ success: false, message: '用户名或密码错误' });
            }
            res.json({ 
                success: true, 
                userId: user.id, 
                nickname: user.nickname,
                score: user.score,
                isAdmin: user.is_admin
            });
        });
});

app.get('/api/random-word', (req, res) => {
    const result = getRandomWord();
    res.json(result);
});

app.post('/api/calc-similarity', async (req, res) => {
    const { guess, target, category } = req.body;
    
    const similarity = calculateSimilarityFallback(guess, target, category);
    res.json({ similarity });
});

app.post('/api/save-record', (req, res) => {
    const { userId, targetWord, category, guessedWord, similarity } = req.body;
    
    db.run('INSERT INTO game_records (user_id, target_word, category, guessed_word, similarity) VALUES (?, ?, ?, ?, ?)',
        [userId, targetWord, category, guessedWord, similarity],
        function(err) {
            if (err) {
                return res.json({ success: false });
            }
            
            if (similarity === 100) {
                db.run('UPDATE users SET score = score + 1 WHERE id = ?', [userId]);
            }
            
            res.json({ success: true, recordId: this.lastID });
        });
});

app.get('/api/leaderboard', (req, res) => {
    db.all('SELECT nickname, score FROM users WHERE score > 0 ORDER BY score DESC LIMIT 20', 
        (err, rows) => {
            if (err) {
                return res.json([]);
            }
            res.json(rows);
        });
});

app.get('/api/user-score/:userId', (req, res) => {
    db.get('SELECT score FROM users WHERE id = ?', [req.params.userId], 
        (err, row) => {
            if (err || !row) {
                return res.json({ score: 0 });
            }
            res.json({ score: row.score });
        });
});

app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});
