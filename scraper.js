const cheerio = require('cheerio');
const axios = require('axios').default;
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const _ = require('lodash');

const db = new sqlite3.Database('data.sqlite');
const host = 'https://www.chewy.com'

function initDatabase() {
	db.run('CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, url TEXT, name TEXT, pictureUrls TEXT, categories TEXT, variables TEXT, description TEXT, attributes TEXT)');
}

async function addProducts(products) {
	const placeholder = new Array(products.length).fill('(?,?)').join(',');
	const statement = db.prepare(`INSERT OR IGNORE INTO products (id,url) VALUES ${placeholder}`);
	statement.run(_.flatten(products.map((p) => [p.id, p.url])));
	return new Promise((res) => {
		statement.finalize(res);
	})
}

async function updateProduct(product) {
	const sql = `
		UPDATE products
		SET
			name = "${product.name}",
			pictureUrls = "${product.pictureUrls.join('\n')}",
			categories = "${product.categories.join('\n')}",
			variables = "${product.variables.join('\n')}",
			description = "${product.description}",
			attributes = "${product.attributes.join('\n')}"
		WHERE id = ${product.id};
	`
	db.run(sql, (res, err) => {
		if (err) {
			console.error(err);
			debugger;
		}
	});
}

async function fetchPage(url) {
	return await axios.get(url)
		.then(res => res.data)
		.catch(error => {
			console.log('Error requesting page: ' + error);
		});
}

async function crawlPage(page) {
	const body = await fetchPage(`https://www.chewy.com/s?rh=rating%3A3&page=${page}`);
	const $ = cheerio.load(body);
	const $products = $('a.product');
	if (!$products.length) return true;
	const products = $products.map(function () {
		const url = $(this).attr('href');
		const id = url.slice(url.lastIndexOf('/') + 1);
		return { id, url: host + url };
	}).get();
	await addProducts(products);
	products.forEach(crawlProduct);
	return false;
}

async function crawlProduct(product) {
	const body = await fetchPage(product.url);
	const $ = cheerio.load(body);
	product.name = $('#product-title h1').text();
	product.pictureUrls = $('#media-selector').find('.main-img,.alt-img').map((idx, el) => 'https:' + el.attribs['href']).get();
	product.categories = $('.breadcrumbs a span[itemprop=name]').map((idx, el) => $(el).text()).get();
	product.variables = $('ul.variation-selector span').map((idx, el) => $(el).text()).get();
	product.description = $('.descriptions__content.cw-tabs__content--left').children().not('.view-all').text();
	product.attributes = $('#attributes li').map(function () {
		const $el = $(this);
		const title = _.trim($el.find('.title').text());
		const value = _.trim($el.find('.value').text());
		return `${title}: ${value}`;
	}).get();
	for (const prop in product) {
		if (typeof product[prop] === 'string') {
			product[prop] = _.trim(product[prop]);
		}
	}
	await updateProduct(product);
}

async function run() {
	let config;
	try {
		const fileContent = fs.readFileSync('config.json');
		config = JSON.parse(fileContent.toString());
	} catch (e) {
		config = {
			currentPage: 1,
			lastPage: false
		};
	}
	do {
		console.log(`page ${config.currentPage}`);
		config.lastPage = await crawlPage(config.currentPage++);
		fs.writeFileSync('config.json', JSON.stringify(config, null, '  '), 'utf8');
	} while (!config.lastPage);
	db.close();
}

(async () => {
	initDatabase();
	console.log('running...');
	await run();
	console.log(done);
})();
